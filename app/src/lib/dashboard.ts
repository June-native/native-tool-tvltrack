import { Contract, JsonRpcProvider, formatUnits } from 'ethers'
import wrappedNlpAbi from '../../../config/WrappedNLP.json'
import vaultsFile from '../../../config/vaults.json'
import eligibleUsersRaw from '../../../config/eligible_users?raw'
import runtimeConfig from '../../../config/runtime-config.json'

const WNLP_BASE_UNIT = 10n ** 18n

const MULTICALL3_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: 'address', name: 'target', type: 'address' },
          { internalType: 'bool', name: 'allowFailure', type: 'bool' },
          { internalType: 'bytes', name: 'callData', type: 'bytes' },
        ],
        internalType: 'struct Multicall3.Call3[]',
        name: 'calls',
        type: 'tuple[]',
      },
    ],
    name: 'aggregate3',
    outputs: [
      {
        components: [
          { internalType: 'bool', name: 'success', type: 'bool' },
          { internalType: 'bytes', name: 'returnData', type: 'bytes' },
        ],
        internalType: 'struct Multicall3.Result[]',
        name: 'returnData',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
] as const

type VaultEntry = {
  address: string
  symbol: string
  chainId: number
  decimals: number
  tokenPrice: number
  /** If > 0, each user's boostable USD is capped at this amount. */
  perUserUsdLimit?: number
}

type ConfigChain = {
  name: string
  rpcUrl: string
  multicall3: string
}

type RuntimeConfig = {
  defaultBatchSize: number
  requestTimeoutMs: number
  refreshIntervalMs: number
  chains: Record<string, ConfigChain>
}

type VaultFile = { vaults: VaultEntry[] }

export type UserPosition = {
  user: string
  rawBalance: bigint
  balance: number
  /** Uncapped TVL USD from balance * exchange * token price. */
  usdValueUncapped: number
  /** Boostable TVL USD after per-user cap (same as uncapped when limit is 0). */
  usdValue: number
}

export type VaultDashboard = {
  vault: VaultEntry
  chainName: string
  exchangeRate: number
  tokenPrice: number
  perUserUsdLimit: number
  totalUsd: number
  totalUsdUncapped: number
  holdersCount: number
  users: UserPosition[]
}

export type RpcDebugEntry = {
  timestamp: string
  level: 'info' | 'error'
  vaultSymbol: string
  chainId: number
  method: string
  message: string
}

type RpcDebugLogger = (entry: RpcDebugEntry) => void

export type DashboardResult = {
  loadedAt: string
  batchSize: number
  usersCount: number
  totalUsdAllVaults: number
  vaults: VaultDashboard[]
  missingInfoSuggestions: string[]
  rpcDebug: RpcDebugEntry[]
}

export type VaultCatalogEntry = VaultEntry
export type RpcOverrides = Record<string, string>
/** Lowercase vault address -> per-user USD cap (0 = no cap). Omitted key uses vaults.json. */
export type PerUserUsdLimitOverrides = Record<string, number>

export type LoadOverrides = {
  batchSize?: number
  rpcUrlsByChainId?: RpcOverrides
  perUserUsdLimitByVault?: PerUserUsdLimitOverrides
}

function parseEligibleUsers(input: string): string[] {
  return input
    .split('\n')
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function mergeVaultWithPerUserCapOverride(vault: VaultEntry, overrides?: LoadOverrides): VaultEntry {
  const map = overrides?.perUserUsdLimitByVault
  const key = vault.address.toLowerCase()
  if (map && Object.prototype.hasOwnProperty.call(map, key)) {
    const cap = map[key]
    return { ...vault, perUserUsdLimit: Number.isFinite(cap) ? cap : (vault.perUserUsdLimit ?? 0) }
  }
  return vault
}

function getSuggestions(vaults: VaultEntry[], config: RuntimeConfig): string[] {
  const suggestions: string[] = []
  if (!config.defaultBatchSize || config.defaultBatchSize <= 0) {
    suggestions.push('Set config.defaultBatchSize to a positive integer.')
  }

  for (const vault of vaults) {
    const chain = config.chains[String(vault.chainId)]
    if (!chain?.rpcUrl) {
      suggestions.push(
        `Missing RPC URL for chain ${vault.chainId} (${vault.symbol}). Add config.chains["${vault.chainId}"].rpcUrl.`,
      )
    }
    if (!chain?.multicall3) {
      suggestions.push(
        `Missing Multicall3 for chain ${vault.chainId} (${vault.symbol}). Add config.chains["${vault.chainId}"].multicall3.`,
      )
    }
    if (vault.tokenPrice <= 0) {
      suggestions.push(
        `tokenPrice for ${vault.symbol} is missing/invalid. Add a current USD price in vaults.json.`,
      )
    }
  }

  return suggestions
}

async function loadVaultDashboard(
  vault: VaultEntry,
  users: string[],
  config: RuntimeConfig,
  batchSize: number,
  rpcDebug: RpcDebugEntry[],
  onLog?: RpcDebugLogger,
): Promise<VaultDashboard> {
  const log = (entry: RpcDebugEntry) => {
    rpcDebug.push(entry)
    onLog?.(entry)
  }

  const chain = config.chains[String(vault.chainId)]
  if (!chain) {
    throw new Error(`No chain config found for chainId=${vault.chainId}`)
  }

  const provider = new JsonRpcProvider(chain.rpcUrl, vault.chainId, {
    staticNetwork: true,
    batchStallTime: 0,
    polling: false,
  })
  provider.pollingInterval = config.requestTimeoutMs

  const wrapped = new Contract(vault.address, wrappedNlpAbi, provider)
  const multicall = new Contract(chain.multicall3, MULTICALL3_ABI, provider)

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    vaultSymbol: vault.symbol,
    chainId: vault.chainId,
    method: 'setup',
    message: `Using RPC ${chain.rpcUrl} and multicall ${chain.multicall3}`,
  })

  const [exchangeRateRaw, wnlpDecimals] = await Promise.all([
    wrapped.getNlpByWnlp(WNLP_BASE_UNIT),
    wrapped.decimals(),
  ])
  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    vaultSymbol: vault.symbol,
    chainId: vault.chainId,
    method: 'getNlpByWnlp/decimals',
    message: 'Fetched exchange rate and decimals',
  })
  const exchangeRate = Number(formatUnits(exchangeRateRaw, 18))

  const balanceIface = wrapped.interface
  const userResults: UserPosition[] = []
  const userChunks = chunk(users, batchSize)

  for (let batchIndex = 0; batchIndex < userChunks.length; batchIndex += 1) {
    const usersBatch = userChunks[batchIndex]
    const calls = usersBatch.map((user) => ({
      target: vault.address,
      allowFailure: true,
      callData: balanceIface.encodeFunctionData('balanceOf', [user]),
    }))

    let responses: {
      success: boolean
      returnData: string
    }[] = []
    try {
      responses = (await multicall.aggregate3.staticCall(calls)) as {
        success: boolean
        returnData: string
      }[]
      log({
        timestamp: new Date().toISOString(),
        level: 'info',
        vaultSymbol: vault.symbol,
        chainId: vault.chainId,
        method: 'aggregate3(balanceOf)',
        message: `Batch ${batchIndex + 1}/${userChunks.length} succeeded (${calls.length} calls)`,
      })
    } catch (error) {
      log({
        timestamp: new Date().toISOString(),
        level: 'error',
        vaultSymbol: vault.symbol,
        chainId: vault.chainId,
        method: 'aggregate3(balanceOf)',
        message: `Batch ${batchIndex + 1}/${userChunks.length} failed: ${String(error)}`,
      })
      continue
    }

    responses.forEach((response, index) => {
      if (!response.success) {
        log({
          timestamp: new Date().toISOString(),
          level: 'error',
          vaultSymbol: vault.symbol,
          chainId: vault.chainId,
          method: 'balanceOf',
          message: `Call failure for user ${usersBatch[index]} in batch ${batchIndex + 1}`,
        })
        return
      }

      const decoded = balanceIface.decodeFunctionResult('balanceOf', response.returnData)
      const rawBalance = decoded[0] as bigint
      if (rawBalance === 0n) return

      const balance = Number(formatUnits(rawBalance, Number(wnlpDecimals)))
      const usdValueUncapped = balance * exchangeRate * vault.tokenPrice
      const limitUsd = vault.perUserUsdLimit && vault.perUserUsdLimit > 0 ? vault.perUserUsdLimit : null
      const usdValue = limitUsd !== null ? Math.min(usdValueUncapped, limitUsd) : usdValueUncapped
      userResults.push({
        user: usersBatch[index],
        rawBalance,
        balance,
        usdValueUncapped,
        usdValue,
      })
    })
  }

  userResults.sort((a, b) => b.usdValue - a.usdValue)
  const totalUsd = userResults.reduce((sum, item) => sum + item.usdValue, 0)
  const totalUsdUncapped = userResults.reduce((sum, item) => sum + item.usdValueUncapped, 0)
  const perUserUsdLimit = vault.perUserUsdLimit ?? 0

  return {
    vault,
    chainName: chain.name,
    exchangeRate,
    tokenPrice: vault.tokenPrice,
    perUserUsdLimit,
    totalUsd,
    totalUsdUncapped,
    holdersCount: userResults.length,
    users: userResults,
  }
}

function getBaseData() {
  const config = runtimeConfig as RuntimeConfig
  const { vaults } = vaultsFile as VaultFile
  const users = parseEligibleUsers(eligibleUsersRaw)
  return { config, vaults, users }
}

function applyOverrides(config: RuntimeConfig, overrides?: LoadOverrides): RuntimeConfig {
  if (!overrides) return config

  const nextConfig: RuntimeConfig = {
    ...config,
    defaultBatchSize: overrides.batchSize && overrides.batchSize > 0 ? overrides.batchSize : config.defaultBatchSize,
    chains: { ...config.chains },
  }

  if (overrides.rpcUrlsByChainId) {
    for (const [chainId, rpcUrl] of Object.entries(overrides.rpcUrlsByChainId)) {
      const trimmed = rpcUrl.trim()
      if (!trimmed) continue
      const chain = nextConfig.chains[chainId]
      if (!chain) continue
      nextConfig.chains[chainId] = {
        ...chain,
        rpcUrl: trimmed,
      }
    }
  }

  return nextConfig
}

export function getVaultCatalog(): VaultCatalogEntry[] {
  const { vaults } = getBaseData()
  return vaults
}

export function getUsersCount(): number {
  const { users } = getBaseData()
  return users.length
}

export function getBatchSize(): number {
  const { config } = getBaseData()
  return config.defaultBatchSize
}

export function getDefaultRpcUrlsByChainId(): RpcOverrides {
  const { config } = getBaseData()
  const urls: RpcOverrides = {}
  for (const [chainId, chainConfig] of Object.entries(config.chains)) {
    urls[chainId] = chainConfig.rpcUrl
  }
  return urls
}

export async function loadDashboardData(
  selectedVaultAddress: string,
  overrides?: LoadOverrides,
  onLog?: RpcDebugLogger,
): Promise<DashboardResult> {
  const { config: baseConfig, vaults, users } = getBaseData()
  const config = applyOverrides(baseConfig, overrides)
  const batchSize = config.defaultBatchSize
  const rpcDebug: RpcDebugEntry[] = []
  const selectedVault = vaults.find(
    (vault) => vault.address.toLowerCase() === selectedVaultAddress.toLowerCase(),
  )

  if (!selectedVault) {
    throw new Error(`Selected vault not found: ${selectedVaultAddress}`)
  }

  const vaultForLoad = mergeVaultWithPerUserCapOverride(selectedVault, overrides)

  let vaultData: VaultDashboard[] = []
  try {
    const loadedVault = await loadVaultDashboard(vaultForLoad, users, config, batchSize, rpcDebug, onLog)
    vaultData = [loadedVault]
  } catch (error) {
    const errorEntry: RpcDebugEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      vaultSymbol: selectedVault.symbol,
      chainId: selectedVault.chainId,
      method: 'loadVaultDashboard',
      message: String(error),
    }
    rpcDebug.push(errorEntry)
    onLog?.(errorEntry)
    throw error
  }

  return {
    loadedAt: new Date().toISOString(),
    batchSize,
    usersCount: users.length,
    totalUsdAllVaults: vaultData[0]?.totalUsd ?? 0,
    vaults: vaultData,
    missingInfoSuggestions: getSuggestions(vaults, config),
    rpcDebug,
  }
}
