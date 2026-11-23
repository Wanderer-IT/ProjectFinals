// Where the login token lives. localStorage is treated as an untrusted cache: the server decides what the token is worth.
const KEY = "brewgo.token";
let onUnauthorized = null;

export function getToken() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function setToken(token) {
  try { token ? localStorage.setItem(KEY, token) : localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}
export function setUnauthorizedHandler(handler) { onUnauthorized = handler; }
export function notifyUnauthorized(error) { if (onUnauthorized) onUnauthorized(error); }
