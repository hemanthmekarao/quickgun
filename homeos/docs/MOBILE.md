# Building the mobile apps

No mobile app is included yet. The backend is ready for one: nothing in the API is specific to the web app, and the web app itself only uses the public REST API.

## What is already shared

`@homeos/shared` has no dependencies and no browser- or Node-specific code, so a React Native / Expo app can import it directly:

- `HomeOSClient` — the same API client the web app uses (fetch-based, handles token refresh).
- `RESOURCES` — every record type with its fields, so screens and forms can be generated as they are on the web.
- `validateRecord` — the same validation the server applies, for instant feedback on the device.
- Role and permission helpers (`can`), formatting and date helpers, reminder and finance logic.

## Authentication for native clients

Native apps do not use cookies. Use the tokens returned in the response body:

```ts
import * as SecureStore from 'expo-secure-store';
import { HomeOSClient } from '@homeos/shared';

const client = new HomeOSClient({
  baseUrl: 'https://api.example.com/v1',
  getRefreshToken: () => SecureStore.getItemAsync('refreshToken'),
  onTokens: async (tokens) => {
    if (tokens?.refreshToken) await SecureStore.setItemAsync('refreshToken', tokens.refreshToken);
    else if (!tokens) await SecureStore.deleteItemAsync('refreshToken');
  },
  onSignedOut: () => navigateToSignIn(),
});

const session = await client.login(email, password, totp);   // session.households lists what the user can access
client.setHousehold(session.households[0].id);
const vehicles = await client.resource('vehicles').list({ status: 'ACTIVE' });
```

Refresh tokens are single-use: always store the new one returned by each refresh (the client does this through `onTokens`). Keep them in the platform keychain/keystore, never in plain storage.

The snippet above uses the `expo-secure-store` API from memory; check the current Expo documentation for exact function names before relying on it.

## Endpoints a mobile app will use

Everything in `/openapi.json`. Notable ones:

| Need | Endpoint |
| --- | --- |
| Home screen | `GET /v1/dashboard` |
| Any list / form | `GET/POST/PATCH/DELETE /v1/<resource>` |
| Photograph a bill | `POST /v1/inbox/upload` (multipart), then `POST /v1/inbox-items/:id/approve` |
| Open a document | `GET /v1/documents/:id/download-url` → open the returned URL in the system viewer |
| Mark a bill paid | `POST /v1/payments/record-offline` |
| Calendar | `GET /v1/calendar?from=&to=` |
| Assistant | `POST /v1/assistant/ask` |
| Push token | `POST /v1/devices` `{ token, platform }` |

## Push notifications

The API stores device tokens (`POST /v1/devices`) and reminder rules already accept the `PUSH` channel, but **no push sender is implemented**: a reminder that asks for push records `NOT_CONFIGURED` and is still delivered in-app. To finish it, add a sender for FCM/APNs (or Expo's push service) in `NotificationsService.deliver` and report it from `channelStatus()`.

## Suggested app structure

- Expo Router with the same route names as the web app.
- A generic `ResourceList` / `RecordForm` pair driven by `RESOURCES`, mirroring `apps/web/src/components/resource.tsx`.
- TanStack Query for data, as on the web.
- Camera capture → `/inbox/upload` for bills and receipts.
- Biometric unlock in front of the stored refresh token.

## CORS

Native apps are not subject to CORS. If you ship a web build of the mobile app on another origin, add it to `WEB_ORIGINS`.
