'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type Privy from '@privy-io/js-sdk-core';
import { SignPagePlugin, type SignPageProps } from '@peerfolio/privy-near-connect/sign-page-plugin';
import { Button, Card, Flex, Heading, Text, TextField, Theme } from '@radix-ui/themes';
import { ensurePrivyNearWallet, getPrivy, signingOrigin } from '@/lib/near/privy';
import '@radix-ui/themes/styles.css';
import '@peerfolio/privy-near-connect/sign-page-plugin/theme.css';

let callback: Promise<void> | null = null;

export default function SignPage() {
  const [privy, setPrivy] = useState<Privy | null>(null);
  const [origin, setOrigin] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getPrivy().then(async (instance) => {
      const allowed = signingOrigin(window.location.origin);
      if (window.location.origin !== allowed) throw new Error('This origin is not permitted to sign.');
      if (!active) return;
      setOrigin(allowed);
      setPrivy(instance);
      const params = new URLSearchParams(window.location.search);
      const authorizationCode = params.get('privy_oauth_code');
      const state = params.get('privy_oauth_state');
      if (authorizationCode && state) {
        callback ??= instance.auth.oauth.loginWithCode(authorizationCode, state, 'google')
          .then(() => { window.history.replaceState(null, '', '/sign'); });
        await callback;
      }
      if (await instance.getAccessToken()) {
        await ensurePrivyNearWallet(instance);
        if (active) setAuthenticated(true);
      }
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Social login failed.');
    });
    return () => { active = false; };
  }, []);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try { await operation(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Social login failed.'); }
    finally { setBusy(false); }
  };

  const loginGoogle = () => void run(async () => {
    if (!privy) return;
    const result = await privy.auth.oauth.generateURL('google', `${origin}/sign`);
    window.location.assign(result.url);
  });

  const loginEmail = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (!privy) return;
      if (!sent) {
        await privy.auth.email.sendCode(email.trim());
        setSent(true);
      } else {
        await privy.auth.email.loginWithCode(email.trim(), code.trim());
        await ensurePrivyNearWallet(privy);
        setAuthenticated(true);
      }
    });
  };

  return (
    <>
      {/* Complete the executor handshake while login is visible, before its READY timeout.
          Keep this mounted so the signing request survives email verification. */}
      {privy && origin && <div hidden={!authenticated}>
        {/* Both resolve to SDK 0.72.1; peer dependency contexts create distinct nominal class types. */}
        <SignPagePlugin privy={privy as unknown as SignPageProps['privy']} options={{ allowedOrigins: [origin], debug: false }} />
      </div>}
      {!authenticated && <Theme appearance="light">
        <Flex align="center" justify="center" minHeight="100vh" p="5">
          <Card size="4">
            <Flex direction="column" gap="4">
              <Heading size="6">Sign in to Hairto Arena</Heading>
              <Text>Continue with Google or email to connect your NEAR wallet.</Text>
              {error && <Text color="red" role="alert">{error}</Text>}
              <Button disabled={!privy || busy} onClick={loginGoogle}>Continue with Google</Button>
              <form onSubmit={loginEmail}>
                <Flex direction="column" gap="3">
                  <Text as="label" htmlFor="email">Email</Text>
                  <TextField.Root id="email" type="email" autoComplete="email" required disabled={sent || busy} value={email} onChange={(event) => setEmail(event.target.value)} />
                  {sent && <>
                    <Text as="label" htmlFor="code">Verification code</Text>
                    <TextField.Root id="code" autoComplete="one-time-code" required value={code} onChange={(event) => setCode(event.target.value)} />
                  </>}
                  <Button type="submit" disabled={!privy || busy}>{busy ? 'Please wait…' : sent ? 'Verify email' : 'Send code'}</Button>
                  {sent && <Button type="button" variant="soft" disabled={busy} onClick={() => { setSent(false); setCode(''); }}>Use a different email</Button>}
                </Flex>
              </form>
            </Flex>
          </Card>
        </Flex>
      </Theme>}
    </>
  );
}
