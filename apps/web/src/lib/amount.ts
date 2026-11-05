export function parseUnits(value: string, decimals: number): bigint {
  if (!/^\d+(?:\.\d*)?$/.test(value)) throw new Error('Enter a valid amount.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error('Too many decimal places.');
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}
export function formatUnits(value: bigint, decimals: number): string {
  const sign = value < 0n ? '-' : '';
  const positive = value < 0n ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const fraction = (positive % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${sign}${positive / scale}${fraction ? `.${fraction}` : ''}`;
}
export function formatAmount(value: bigint, decimals: number) {
  const [whole, fraction = ''] = formatUnits(value, decimals).split('.');
  const short = fraction.slice(0, 2).replace(/0+$/, '');
  return `${BigInt(whole!).toLocaleString('en-US')}${short ? `.${short}` : ''}`;
}
