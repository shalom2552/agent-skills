export async function sha(text: string) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')
}
