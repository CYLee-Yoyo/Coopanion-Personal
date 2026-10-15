/** Public account state and the private IPC credential capability used by the subscription provider. */
export interface ChatGPTStatus {
  connected: boolean;
  sharing: boolean;
  pending: boolean;
  email: string | null;
  account: string | null;
  error: string | null;
}
export interface ChatGPTSession {
  status(): ChatGPTStatus;
  action(method: 'status' | 'signin' | 'signout' | 'cancel' | 'usage'): Promise<ChatGPTStatus>;
  token(force?: boolean): Promise<{ accessToken: string; account: string | null }>;
  signal?(): AbortSignal;
}
export const CHATGPT_KIND = 'chatgpt-plan';
export const CHATGPT_ENDPOINT = 'chatgpt-plan';
export const CHATGPT_BASE_URL = 'https://api.openai.com/v1';
