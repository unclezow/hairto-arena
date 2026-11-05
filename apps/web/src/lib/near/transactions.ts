/** Balance observers refresh after confirmed player transactions. */
export function transactionCompleted() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('hairto:transaction'));
}
