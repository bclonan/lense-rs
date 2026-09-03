export type Target = { type: 'monitor' | 'window'; id: string }
export interface Point { x: number; y: number }
export interface Box extends Point { width: number; height: number }
export type DesktopAction =
  | ({ type: 'pointer.move' | 'pointer.click' | 'pointer.doubleClick'; button?: 'left' | 'right' | 'middle'; target?: Target } & Point)
  | { type: 'pointer.drag'; from: Point; to: Point; durationMs: number; target?: Target }
  | { type: 'keyboard.type'; text: string }
  | { type: 'keyboard.key'; key: string }
  | { type: 'keyboard.hotkey'; keys: string[] }
  | { type: 'scroll'; deltaX: number; deltaY: number }
  | { type: 'window.focus'; windowId: string }
export interface Monitor { id: string; name: string; x: number; y: number; width: number; height: number; scaleFactor: number; primary: boolean }
export interface DesktopWindow { id: string; title: string; x: number; y: number; width: number; height: number; minimized?: boolean }
export interface Observation { id: string; timestamp: string; target: Target; region?: Box; nativeWidth: number; nativeHeight: number; width: number; height: number; mimeType: string; image: string; foregroundWindow?: DesktopWindow; cursor?: Point }
export interface CaptureOptions { target?: Target; region?: Box; maxDimension?: number; quality?: number }
export interface Annotation { label: string; confidence: number; box: Box }
export interface EvaluationResult { condition: string; result: boolean; confidence: number; explanation: string; regions?: Annotation[] }
export interface LenseEvent { id: string; taskId?: string; timestamp: string; type: string; data: Record<string, unknown>; observation?: Observation }
export interface BridgeStatus { name: string; version: string; protocolVersion: number; platform: string; capabilities: string[]; dryRun?: boolean; port?: number; endpoint?: string }
export interface Session { id: string; token: string; origin: string; scopes: string[]; createdAt: string }
export interface ActionResult { id: string; ok: boolean; startedAt: string; completedAt: string; action: DesktopAction; result: Record<string, unknown> }
export interface WatchSpec { id: string; target?: Target; region?: Box; intervalMs: number; mode: 'visual-change'; threshold: number }
export interface DesktopAdapter { observe(options?: CaptureOptions, signal?: AbortSignal): Promise<Observation>; action(action: DesktopAction, signal?: AbortSignal): Promise<ActionResult>; createWatch?(spec: WatchSpec): Promise<unknown>; removeWatch?(id: string): Promise<void>; subscribe?(listener: (event: LenseEvent) => void): () => void }
export type TaskState = 'IDLE' | 'PAIRING' | 'OBSERVING' | 'PLANNING' | 'LOCATING_TARGET' | 'EXECUTING' | 'SETTLING' | 'VERIFYING' | 'WAITING' | 'RECOVERING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'STOPPED'
export interface TaskContext { game: 'generic' | 'osrs' | 'rs3'; characterName?: string; location?: string; skills?: string; inventory?: string; notes?: string }
export interface TaskMonitoring { mode: 'interval' | 'events-and-interval'; watchIntervalMs: number; settleMs: number }
export interface TaskWakeEvent { sequence: number; type: string; message: string; timestamp: string }
export interface TaskWakeResult { events: TaskWakeEvent[]; lastSequence: number; timedOut: boolean }
export interface TaskConfig { goal: string; durationMs: number; verification: {condition: string; intervalMs: number}; invariants: string[]; limits: {maxConsecutiveFailures: number; maxActionsPerMinute: number; confidenceThreshold: number}; deadline?: string; runMode?: 'timed' | 'until-complete' | 'continuous'; completionCondition?: string; monitoring?: TaskMonitoring; context?: TaskContext }
export interface TaskRecord extends TaskConfig { id: string; state: TaskState; createdAt: string; startedAt?: string; elapsedMs: number; failures: number; recoveries: number; observations: number; actions: number; evaluations: number; watchChecks: number; nextCheckAt?: number; reason?: string; cycles?: number; wakeSequence?: number }
export interface VisualEvaluator { evaluate(input: {frame: Observation; condition: string; priorFrame?: Observation; context?: unknown}, signal?: AbortSignal): Promise<EvaluationResult> }
export interface AgentPlan { explanation: string; actions: DesktopAction[]; confidence: number; completed?: boolean }
export interface AgentProvider extends VisualEvaluator { plan(input: {frame: Observation; task: TaskConfig}, signal?: AbortSignal): Promise<AgentPlan>; recover(input: {frame: Observation; task: TaskConfig; evaluation: EvaluationResult}, signal?: AbortSignal): Promise<AgentPlan> }
