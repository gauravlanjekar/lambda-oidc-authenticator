'use strict';

// static setup that can be done at load-time

var ACCESS_TOKEN_LENGTH = 16; // (apparent) length of an Autho0 access_token

// Lambda now supports environment variables - http://docs.aws.amazon.com/lambda/latest/dg/tutorial-env_cli.html
// a .env file can be used as a development convenience. Real environment variables can be used in deployment and
// will override anything loaded by dotenv.
require('dotenv').config();
const KeyCloakCerts = require('get-keycloak-public-key');

//certs path 'http://auth-server/auth/realms/master/protocol/openid-connect/certs'
const keyCloakCerts = new KeyCloakCerts(process.env.certsPath);


var fs = require('fs');
var Promise = require('bluebird');
Promise.longStackTraces();


///// TODO : use promises to load these asynchronously
///// return Promise.resolve to return cached values
///// see : http://bluebirdjs.com/docs/api/promise.method.html


var policyDocumentFilename = 'policyDocument.json';
var policyDocument;
try {
  policyDocument = JSON.parse(fs.readFileSync(__dirname + '/' + policyDocumentFilename, 'utf8'));
} catch (e) {
  if (e.code === 'ENOENT') {
    console.error('Expected ' + policyDocumentFilename + ' to be included in Lambda deployment package');
    // fallthrough
  }
  throw e;
}

var dynamoParametersFilename = 'dynamo.json';
var dynamoParameters = null;
try {
  dynamoParameters = JSON.parse(fs.readFileSync(__dirname + '/' + dynamoParametersFilename, 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') {
    throw e;
  }
  // otherwise fallthrough
}

var jwt = require('jsonwebtoken');


// extract and return the Bearer Token from the Lambda event parameters
var getToken = function (params) {
  var token;

  if (!params.type || params.type !== 'TOKEN') {
    throw new Error("Expected 'event.type' parameter to have value TOKEN");
  }

  var tokenString = params.authorizationToken;
  if (!tokenString) {
    throw new Error("Expected 'event.authorizationToken' parameter to be set");
  }

  var match = tokenString.match(/^Bearer (.*)$/);
  if (!match || match.length < 2) {
    throw new Error("Invalid Authorization token - '" + tokenString + "' does not match 'Bearer .*'");
  }
  return match[1];
}

var returnUserInfo = function (data) {
  if (!data) throw new Error('data empty return');
  if (data === 'Unauthorized') {
    throw new Error('Unauthorized')
  } else {
    var user = {};
    user.name = data.name;
    user.email = data.email;
    user.preferred_username = data.preferred_username;
    user.given_name = data.given_name;
    user.family_name = data.family_name;
    user.principalId = getPrincipalId(data)
    console.log(user);


    return user
  }
}


// extract user_id from the autho0 userInfo and return it for AWS principalId
var getPrincipalId = function (userInfo) {
  if (!userInfo || (!userInfo.email && !userInfo.preferred_username)) {
    throw new Error("No email returned from authentication service");
  }
  console.log('authentication successful for user ' + (userInfo.email || userInfo.preferred_username));

  return userInfo.email || preferred_username;
}

// return the expected Custom Authorizaer JSON object
var getAuthentication = function (userInfo) {
  return {
    principalId: userInfo.principalId,
    policyDocument: policyDocument,
    context: userInfo
  }
}

//verify the signature on the token
var verifyToken = function (token) {
  return new Promise(function (fulfill, reject) {
    // decode the token without verification to have the kid value
    const kid = jwt.decode(token, {complete: true}).header.kid;

    // fetch the PEM Public Key
    const publicKey = keyCloakCerts.fetch(kid);

    publicKey.then((key) => {
        try {
          // Verify and decode the token
          const decoded = jwt.verify(token, key);
          console.log("token verified successfully ");
          fulfill(decoded);
        } catch (error) {
          // Token is not valid
          reject("invalid token")
        }
      }
    ).catch(() => {
      // KeyCloak has no Public Key for the specified KID
      reject("invalid key id");
    });

  });

};

module.exports.authenticate = function (params) {
  var token = getToken(params);

  var getTokenDataPromise;

  getTokenDataPromise = verifyToken(token);


  return getTokenDataPromise
    .then(returnUserInfo)
    .then(getAuthentication);
}
