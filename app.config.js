const fs = require('node:fs');
const path = require('node:path');

module.exports = ({ config }) => {
  const expoConfig = { ...config, android: { ...config.android } };
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
  if (fs.existsSync(path.resolve(__dirname, googleServicesFile))) {
    expoConfig.android.googleServicesFile = googleServicesFile;
  } else {
    delete expoConfig.android.googleServicesFile;
  }
  return expoConfig;
};
