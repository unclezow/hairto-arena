const SECRET_PARAM = /([?&](?:api[-_]?key|apikey|key|token|access[-_]?token)=)[^&#\s]*/gi;

/** A URL for logs and status pages: the value of a query parameter that carries a key is replaced. */
export function redactUrlSecrets(url: string): string {
  return url.replace(SECRET_PARAM, '$1<hidden>');
}
