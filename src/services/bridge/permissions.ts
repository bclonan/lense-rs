export type LoopbackPermission = PermissionState | 'unsupported'
export async function loopbackPermission(): Promise<LoopbackPermission> {
  if (!globalThis.navigator?.permissions?.query) return 'unsupported'
  for (const name of ['loopback-network', 'local-network-access']) {
    try { return (await navigator.permissions.query({name: name as PermissionName})).state } catch { /* Browsers ship different permission names. */ }
  }
  return 'unsupported'
}
export function loopbackRequestOptions(): RequestInit {
  // Unknown WebIDL dictionary fields are ignored. Detect synchronously, never retry a sent mutation.
  try {
    new Request('http://127.0.0.1:17373/v1/status', { targetAddressSpace:'loopback' } as RequestInit)
    return { targetAddressSpace:'loopback' } as RequestInit
  } catch { return {} }
}
