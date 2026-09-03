export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations?: { readOnlyHint: boolean }
  execute: (input: Record<string, unknown>, context?: { signal?: AbortSignal }) => Promise<unknown>
}
export interface ModelContext {
  registerTool(tool: Tool, options?: { signal?: AbortSignal }): unknown
  unregisterTool?(name: string): unknown
}
