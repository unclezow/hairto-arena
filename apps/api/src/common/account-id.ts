/** NEAR account id rules (NEP-0006): 2 to 64 characters, lowercase parts joined by `.`, `-` or `_`. */
export const ACCOUNT_ID_PATTERN =
  /^(?=.{2,64}$)(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

/** An implicit account id: the 64 hex characters of an ed25519 public key. */
export const IMPLICIT_ACCOUNT_PATTERN = /^[0-9a-f]{64}$/;

export function isAccountId(value: string): boolean {
  return ACCOUNT_ID_PATTERN.test(value);
}
