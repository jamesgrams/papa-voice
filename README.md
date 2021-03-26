# Papa Voice

Voice control platform to work with Papa's set up. Designed for Raspberry Pi.

Make sure the XMPP API is anabled on the Harmony Hub. You may also want
to change the name of the hub. You can use the Harmony API to get the slug
of your device. Many are hardcoded into this project.

## Setup
1. Clone this repo
2. `cd` to this repo
3. `git submodule update --init --recursive`
4. `npm install`
5. `cd` to `lib/harmony`
6. Run `script/bootstrap`
7. Run `sudo script/install-linux`
8. You may need to reboot or run `sudo service harmony-api-server start`
8. `cd ../..`
9. Make sure you have a Project and Google Cloud Credentials here: [https://cloud.google.com/speech-to-text/docs/quickstart-client-libraries#client-libraries-usage-nodejs](https://cloud.google.com/speech-to-text/docs/quickstart-client-libraries#client-libraries-usage-nodejs)
    a. Likewise, set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to your credential file's path (`/etc/environment`).
10. `npm start`
