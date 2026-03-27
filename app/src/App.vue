<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  getBatchSize,
  getDefaultRpcUrlsByChainId,
  getUsersCount,
  getVaultCatalog,
  loadDashboardData,
  type DashboardResult,
  type LoadOverrides,
  type RpcDebugEntry,
  type RpcOverrides,
  type UserPosition,
  type VaultCatalogEntry,
  type VaultDashboard,
} from './lib/dashboard'

const vaultCatalog = ref<VaultCatalogEntry[]>(getVaultCatalog())
const usersCount = ref(getUsersCount())
const loading = ref(false)
const error = ref<string | null>(null)
const dashboard = ref<DashboardResult | null>(null)
const selectedVaultAddress = ref<string | null>(null)
const userSort = ref<'usdDesc' | 'usdAsc' | 'balanceDesc' | 'balanceAsc' | 'addressAsc'>('usdDesc')
const showDebug = ref(false)
const rpcLogs = ref<RpcDebugEntry[]>([])
const loadedVaults = ref<Record<string, VaultDashboard>>({})
const lastLoadedAt = ref<string | null>(null)
const batchSizeOverride = ref<number>(getBatchSize())
const rpcOverrides = ref<RpcOverrides>(getDefaultRpcUrlsByChainId())
const debugPanelRef = ref<HTMLElement | null>(null)

const BATCH_SIZE_COOKIE = 'tvl_batch_size'
const RPC_OVERRIDES_COOKIE = 'tvl_rpc_overrides'

function setCookie(name: string, value: string, days = 365) {
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

function getCookie(name: string): string | null {
  const cookies = document.cookie.split('; ')
  const prefix = `${name}=`
  const found = cookies.find((cookie) => cookie.startsWith(prefix))
  if (!found) return null
  return decodeURIComponent(found.slice(prefix.length))
}

function saveOverridesToCookies() {
  setCookie(BATCH_SIZE_COOKIE, String(batchSizeOverride.value))
  setCookie(RPC_OVERRIDES_COOKIE, JSON.stringify(rpcOverrides.value))
}

function loadOverridesFromCookies() {
  const batchSizeCookie = getCookie(BATCH_SIZE_COOKIE)
  if (batchSizeCookie) {
    const parsed = Number(batchSizeCookie)
    if (Number.isFinite(parsed) && parsed > 0) {
      batchSizeOverride.value = parsed
    }
  }

  const rpcOverridesCookie = getCookie(RPC_OVERRIDES_COOKIE)
  if (rpcOverridesCookie) {
    try {
      const parsed = JSON.parse(rpcOverridesCookie) as RpcOverrides
      rpcOverrides.value = {
        ...rpcOverrides.value,
        ...parsed,
      }
    } catch {
      // Ignore malformed cookie and keep defaults
    }
  }
}

function scrollDebugToBottom() {
  if (!loading.value) return
  if (!showDebug.value) return
  nextTick(() => {
    if (!debugPanelRef.value) return
    debugPanelRef.value.scrollTop = debugPanelRef.value.scrollHeight
  })
}

const selectedVault = computed<VaultDashboard | null>(() => {
  if (!selectedVaultAddress.value) return null
  return loadedVaults.value[selectedVaultAddress.value] ?? null
})

const selectedVaultMeta = computed(() => {
  if (!selectedVaultAddress.value) return null
  return vaultCatalog.value.find((vault) => vault.address === selectedVaultAddress.value) ?? null
})

const selectedChainId = computed<string | null>(() => {
  return selectedVaultMeta.value ? String(selectedVaultMeta.value.chainId) : null
})

const sortedUsers = computed<UserPosition[]>(() => {
  if (!selectedVault.value) return []
  const users = [...selectedVault.value.users]
  switch (userSort.value) {
    case 'usdAsc':
      users.sort((a, b) => a.usdValue - b.usdValue)
      break
    case 'balanceDesc':
      users.sort((a, b) => b.balance - a.balance)
      break
    case 'balanceAsc':
      users.sort((a, b) => a.balance - b.balance)
      break
    case 'addressAsc':
      users.sort((a, b) => a.user.localeCompare(b.user))
      break
    case 'usdDesc':
    default:
      users.sort((a, b) => b.usdValue - a.usdValue)
      break
  }
  return users
})

async function refresh() {
  if (!selectedVaultAddress.value) {
    error.value = 'Please select a vault first.'
    return
  }
  loading.value = true
  showDebug.value = true
  error.value = null

  try {
    const overrides: LoadOverrides = {
      batchSize: batchSizeOverride.value,
      rpcUrlsByChainId: rpcOverrides.value,
    }
    const data = await loadDashboardData(selectedVaultAddress.value, overrides, (entry) => {
      rpcLogs.value = [...rpcLogs.value, entry]
    })
    dashboard.value = data
    if (data.vaults[0]) {
      loadedVaults.value = {
        ...loadedVaults.value,
        [data.vaults[0].vault.address]: data.vaults[0],
      }
      lastLoadedAt.value = data.loadedAt
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
    showDebug.value = false
  }
}

onMounted(() => {
  loadOverridesFromCookies()
})

watch(rpcLogs, () => {
  scrollDebugToBottom()
})
</script>

<template>
  <main class="app">
    <section class="pinned-vault-totals">
      <h2>USD per vault</h2>
      <div class="pinned-grid">
        <article v-for="vault in vaultCatalog" :key="vault.address" class="mini-card">
          <p class="mini-title">{{ vault.symbol }}</p>
          <p class="mini-value" v-if="loadedVaults[vault.address]">
            ${{ loadedVaults[vault.address].totalUsd.toLocaleString(undefined, { maximumFractionDigits: 2 }) }}
          </p>
          <p class="mini-value muted" v-else>Not loaded</p>
        </article>
      </div>
    </section>

    <header class="header">
      <h1>Boost TVL Dashboard</h1>
      <div class="header-actions">
        <button class="refresh secondary" @click="showDebug = !showDebug">
          {{ showDebug ? 'Hide RPC Debug' : 'Show RPC Debug' }}
        </button>
        <button class="refresh" :disabled="loading || !selectedVaultAddress" @click="refresh">
          {{ loading ? 'Loading...' : 'Load' }}
        </button>
      </div>
    </header>

    <p class="sub">
      Select a vault and click <code>Load</code>. Reads eligible users, batches <code>balanceOf</code> through
      multicall, then computes:
      <code>userBalance * (getNlpByWnlp(1e18) / 1e18) * tokenPriceUsd</code>
    </p>

    <section class="card overrides">
      <h2>Overrides (stored in cookies)</h2>
      <div class="override-row">
        <label for="batchSizeOverride">Batch size</label>
        <input id="batchSizeOverride" v-model.number="batchSizeOverride" type="number" min="1" step="1" />
      </div>
      <div class="override-grid">
        <div v-if="selectedChainId" :key="`rpc-${selectedChainId}`" class="override-row">
          <label :for="`rpc-${selectedChainId}`">RPC (Chain {{ selectedChainId }})</label>
          <input
            :id="`rpc-${selectedChainId}`"
            v-model="rpcOverrides[selectedChainId]"
            type="text"
            placeholder="https://rpc-url"
          />
        </div>
        <p v-else class="hint">Select a vault to configure its RPC override.</p>
      </div>
      <button class="refresh secondary" @click="saveOverridesToCookies">Save overrides to cookies</button>
    </section>

    <section v-if="loading" class="loading-screen">
      <h2>Loading vault data...</h2>
      <p>RPC debug log auto-opened. Please wait while multicall batches are processed.</p>
    </section>

    <section v-if="error" class="error">
      <strong>Failed to load dashboard:</strong> {{ error }}
    </section>

    <section class="summary-grid">
      <article class="card">
        <h2>Total USD (loaded vaults)</h2>
        <p class="big">
          ${{
            Object.values(loadedVaults).reduce((sum, item) => sum + item.totalUsd, 0).toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })
          }}
        </p>
      </article>
      <article class="card">
        <h2>Eligible users</h2>
        <p class="big">{{ usersCount.toLocaleString() }}</p>
      </article>
      <article class="card">
        <h2>Batch size</h2>
        <p class="big">{{ batchSizeOverride }}</p>
      </article>
      <article class="card">
        <h2>Last loaded (UTC)</h2>
        <p class="big small">{{ lastLoadedAt ?? 'Not loaded yet' }}</p>
      </article>
    </section>

    <section v-if="dashboard?.missingInfoSuggestions?.length" class="suggestions">
      <h2>Config / metadata suggestions</h2>
      <ul>
        <li v-for="suggestion in dashboard.missingInfoSuggestions" :key="suggestion">{{ suggestion }}</li>
      </ul>
    </section>

    <section v-if="showDebug" ref="debugPanelRef" class="debug-panel">
      <h2>RPC debug log</h2>
      <div class="debug-head">
        <span>Time</span>
        <span>Vault / Chain</span>
        <span>Method</span>
        <span>Level</span>
        <span>Message</span>
      </div>
      <div v-for="(log, index) in rpcLogs" :key="`${index}-${log.timestamp}`" class="debug-row">
        <span>{{ log.timestamp }}</span>
        <span>{{ log.vaultSymbol }} / {{ log.chainId }}</span>
        <span><code>{{ log.method }}</code></span>
        <span :class="log.level === 'error' ? 'level-error' : 'level-info'">{{ log.level }}</span>
        <span class="debug-message">{{ log.message }}</span>
      </div>
      <p v-if="rpcLogs.length === 0" class="hint">No RPC calls logged yet.</p>
    </section>

    <section class="vault-section">
      <div class="vault-picker">
        <label for="vault">Vault:</label>
        <select id="vault" v-model="selectedVaultAddress">
          <option :value="null" disabled>Select a vault</option>
          <option v-for="vault in vaultCatalog" :key="vault.address" :value="vault.address">
            {{ vault.symbol }} (Chain {{ vault.chainId }})
          </option>
        </select>
      </div>

      <div v-if="selectedVault" class="vault-details">
        <article class="card">
          <h2>{{ selectedVault.vault.symbol }}</h2>
          <p><strong>Vault:</strong> <code>{{ selectedVault.vault.address }}</code></p>
          <p><strong>Chain:</strong> {{ selectedVault.chainName }} ({{ selectedVault.vault.chainId }})</p>
          <p><strong>Token price:</strong> ${{ selectedVault.tokenPrice }}</p>
          <p><strong>Exchange rate:</strong> {{ selectedVault.exchangeRate.toFixed(8) }}</p>
          <p><strong>Holders:</strong> {{ selectedVault.holdersCount.toLocaleString() }}</p>
          <p>
            <strong>Vault USD:</strong>
            ${{ selectedVault.totalUsd.toLocaleString(undefined, { maximumFractionDigits: 2 }) }}
          </p>
        </article>

        <article class="card users">
          <h2>Top users by USD</h2>
          <div class="sort-wrap">
            <label for="sortBy">Sort by:</label>
            <select id="sortBy" v-model="userSort">
              <option value="usdDesc">USD (high to low)</option>
              <option value="usdAsc">USD (low to high)</option>
              <option value="balanceDesc">wNLP (high to low)</option>
              <option value="balanceAsc">wNLP (low to high)</option>
              <option value="addressAsc">Address (A-Z)</option>
            </select>
          </div>
          <div class="table-head">
            <span>User</span>
            <span>wNLP</span>
            <span>USD</span>
          </div>
          <div v-for="user in sortedUsers" :key="user.user" class="row">
            <code>{{ user.user }}</code>
            <span>{{ user.balance.toLocaleString(undefined, { maximumFractionDigits: 6 }) }}</span>
            <span>${{ user.usdValue.toLocaleString(undefined, { maximumFractionDigits: 2 }) }}</span>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>
