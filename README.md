# Papa Voice

Voice control platform to work with Papa's set up.

## Setup
1. Clone this repo
2. `cd` to this repo
3. `npm install`
4. `cd` to `lib/harmony`
5. Run `script/bootstrap`
6. `cd ../..`
7. Make sure you have a Project and Google Cloud Credentials here: `https://cloud.google.com/speech-to-text/docs/quickstart-client-libraries#client-libraries-usage-nodejs`
    a. Likewise, set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to your credential file's path.
8. `npm start`