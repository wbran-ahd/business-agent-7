# Google Firestore — Recommended Service Integration

## Service
- Google Firestore
- Category: Database
- Description: Serverless NoSQL document database with realtime sync.

## Install steps (from the recommended service details)
1. Add the official client library to your project environment.
   - `npm install firebase`
2. Create a Firestore database in your Google Cloud project (Native mode), or use the console at `https://console.cloud.google.com/firestore/databases`.
   - Enable the Cloud Firestore API if it is not already enabled.
3. Authenticate with Application Default Credentials.
   - For local development, log in with `gcloud auth application-default login`.
   - For servers, create a service account with Firestore IAM permissions and point `GOOGLE_APPLICATION_CREDENTIALS` at its JSON key.
4. Initialize the Firestore client in your code.
   - A simple example: `from google.cloud import firestore; db = firestore.Client()`
5. Wire the main flow:
   - Write a document and run a query against your collection.
6. Verify:
   - Confirm the document write and query results.
   - Check that the data appears in the Firestore section of the Google Cloud console.

## Required API keys / environment variables
- `GOOGLE_APPLICATION_CREDENTIALS`
- `GOOGLE_CLOUD_PROJECT`

## Notes for this project
- This project already has Firebase initialized in `src/lib/firebase.ts` using the modular web SDK (`firebase/app`, `firebase/auth`, `firebase/firestore`).
- The existing app uses Firestore from the browser with anonymous authentication and project-specific Firebase config.
- Because of that, the relevant setup here is the Firebase console project + config values, not a separate server-side `google-cloud-firestore` client.
- The keys you need to add in the Keys / API keys UI are the Firebase web app config values used by the frontend, plus any project-level variables the app reads from the environment.

## Keys to add in the project Keys tab
Add these as environment variables in the project Keys / API keys UI:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

If your Firebase project has Google Analytics enabled, also add:
- `VITE_FIREBASE_MEASUREMENT_ID`

For server-side or Admin SDK use (not required by the current frontend), the service recommends setting:
- `GOOGLE_APPLICATION_CREDENTIALS`
- `GOOGLE_CLOUD_PROJECT`
