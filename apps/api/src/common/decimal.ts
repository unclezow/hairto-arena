/** Exact `price * 10^expo` as a plain decimal string, without going through floating point. */
export function toDecimalString(price: bigint, expo: number): string {
  const negative = price < 0n;
  const digits = (negative ? -price : price).toString();
  let out: string;
  if (expo >= 0) {
    out = digits + '0'.repeat(expo);
  } else {
    const scale = -expo;
    const padded = digits.padStart(scale + 1, '0');
    const whole = padded.slice(0, -scale);
    const fraction = padded.slice(-scale).replace(/0+$/, '');
    out = fraction ? `${whole}.${fraction}` : whole;
  }
  return negative && out !== '0' ? `-${out}` : out;
}
