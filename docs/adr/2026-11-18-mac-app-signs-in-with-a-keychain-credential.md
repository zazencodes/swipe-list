# The Mac app signs in with a Swipe List credential kept in the Keychain

## Decision

- The app calls the public agent API with a Swipe List credential (`Authorization: Bearer swl_...`), the same kind of credential agents and the `swipe` CLI use.
- The credential is kept in the login Keychain and nowhere else. The app checks it with the server before saving it.
- On the sign-in screen the owner either pastes a credential or presses "Use Swipe CLI connection", which reads the connection `swipe login` saved, at the path the CLI resolves. The app only reads the CLI's file. It imports only when that button is pressed, so after Sign Out the app stays signed out.
- The build signs ad hoc; an owner with an Apple Development identity can sign with it so the Keychain keeps trusting the app across rebuilds.

## Why

- The agent API is reachable from anywhere and accepts every call the app makes, while the dashboard's owner session needs the tailnet and an emailed code.
- A Mac with the CLI already logged in can be connected without anyone handling the token.
- The Keychain is the platform's place for secrets; a file or preference would put the token in plain text.

## Rejected

- **Email one-time code through the dashboard's login proxy.** Tailnet-only, and it ties the app to Neon Auth's HTTP protocol.
- **Reading the CLI's file on every launch.** Signing out would not stick, and the app would depend on the CLI's file staying put.
- **A bundled or built-in credential.** Secrets never ship in the app.
