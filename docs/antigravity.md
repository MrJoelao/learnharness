# Google Antigravity provider

This is a desktop-only subscription adapter for Google Antigravity. It
uses Google OAuth and Antigravity's `cloudcode-pa` service protocol through
the MIT-licensed `@cortexkit/antigravity-auth-core` package. The ordinary
Google Gemini API-key provider remains separate.

Google's [Antigravity FAQ](https://www.antigravity.google/docs/faq) and
[Terms](https://www.antigravity.google/terms) explicitly say third-party
software access violates the Terms and may result in suspension or termination
of the Antigravity or Gemini CLI account. Google does not support or endorse
this adapter. Do not use it unless you accept that account risk. The web/dev
subscription path does not support this provider.

The adapter exposes six IDs from CortexKit's public catalog:

| Model | Provider ID | Thinking levels |
|---|---|---|
| Gemini 3.8 Flash | `antigravity-gemini-3.8-flash` | Low, medium, high |
| Gemini 3.5 Flash | `antigravity-gemini-3.5-flash` | Low, medium, high |
| Gemini 4 Argon | `antigravity-gemini-4-argon` | Low, medium, high |
| Claude Sonnet 4.6 | `antigravity-claude-sonnet-4-6` | Low, medium, high |
| Claude Sonnet 5.5 | `antigravity-claude-sonnet-5-5` | Low, medium, high |
| Claude Opus 4.6 Thinking | `antigravity-claude-opus-4-6-thinking` | Medium, high |
| Claude Opus 5.5 | `antigravity-claude-opus-5-5` | Low, medium, high |
| GPT-OSS 120B Medium | `antigravity-gpt-oss-120b-medium` | Medium |

CortexKit declares image input for these eight models. The adapter forwards user
images as Gemini `inlineData` parts, so the models appear in the Vision slot.
The separate CortexKit model `antigravity-gemini-3.1-flash-image` is not part
of this experiment's picker.

Note: Claude Sonnet 4.6 and Claude Opus 4.6 Thinking are now supported and will
be available when connecting to Antigravity Pro accounts. The picker handles
both 4.6 and 5.5 version models through alias mapping for backward compatibility.

The model IDs and thinking tiers come from CortexKit. They do not guarantee
access for a Google account. Plan notes supplied with this experiment say
Gemini 3.5 Flash is absent from Google's current Pro model table, Gemini 4
Argon availability differs by source, Claude Sonnet and Opus require paid Pro,
and GPT-OSS 120B is expected to leave Pro on November 2, 2026. These plan
claims have not been independently verified. The app reports authorization,
quota, and unavailable-model failures without switching providers. It forwards
usage counts and reports zero cost because the service does not provide API
billing rates to this adapter.

OAuth and credentials are owned by Electron main and stored in the existing
owner-only, atomic subscription file. During sign-in, LearnHarness listens on
`localhost:51121/oauth-callback`, checks the OAuth state, and exchanges the
code. If the port is busy, the sign-in prompt accepts the callback URL or code.
After sign-in, LearnHarness filters the picker using model names returned for
the connected account. If catalog lookup fails, it keeps the bundled catalog.
The Antigravity request format, OAuth client details, endpoint, metadata and
model routing are private and may change without notice. No live Google
account flow or teaching session has been verified by automated tests; tests
use injected OAuth/network doubles.

The MIT dependency retains its own license and copyright notice in
`node_modules/@cortexkit/antigravity-auth-core/LICENSE`; LearnHarness does not
copy CortexKit's Pi extension or its Pi coding-agent API.
