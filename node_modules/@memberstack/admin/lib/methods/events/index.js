"use strict";
var __read = (this && this.__read) || function (o, n) {
    var m = typeof Symbol === "function" && o[Symbol.iterator];
    if (!m) return o;
    var i = m.call(o), r, ar = [], e;
    try {
        while ((n === void 0 || n-- > 0) && !(r = i.next()).done) ar.push(r.value);
    }
    catch (error) { e = { error: error }; }
    finally {
        try {
            if (r && !r.done && (m = i["return"])) m.call(i);
        }
        finally { if (e) throw e.error; }
    }
    return ar;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifySignature = exports.verifyWebhookSignature = void 0;
var crypto_1 = __importDefault(require("crypto"));
var createSignature = function (signingSecret, date, messageBody) {
    var data = date + "." + JSON.stringify(messageBody);
    return crypto_1.default.createHmac("sha256", signingSecret).update(data).digest("hex");
};
var verifyWebhookSignature = function (_a) {
    var headers = _a.headers, secret = _a.secret, payload = _a.payload, _b = _a.tolerance, tolerance = _b === void 0 ? 300 : _b;
    // if headers doesn't contain svix-id, svix-timestamp, or svix-signature, throw error
    var svix_id = headers['SVIX-ID'];
    var svix_timestamp = headers['SVIX-TIMESTAMP'];
    var svix_signature = headers['SVIX-SIGNATURE'];
    if (!svix_id || !svix_timestamp || !svix_signature) {
        throw new Error("Please provide the svix-id, svix-timestamp, and svix-signature headers");
    }
    // Compare timestamp with current timestamp, if it's greater than tolerance throw error
    if (Math.abs(svix_timestamp - Date.now() / 1000) > tolerance) {
        throw new Error("The timestamp provided in svix-timestamp header is outside of the tolerance limit.");
    }
    var signedContent = svix_id + "." + svix_timestamp + "." + JSON.stringify(payload);
    // Need to base64 decode the secret
    var secretBytes = Buffer.from(secret.split('_')[1], "base64");
    var signature = crypto_1.default
        .createHmac('sha256', secretBytes)
        .update(signedContent)
        .digest('base64');
    // verify signature matches svix_signature using constant-time comparison
    var match = crypto_1.default.timingSafeEqual(Buffer.from(signature), Buffer.from(svix_signature.split('v1,')[1]));
    if (!match) {
        throw new Error("The signature did not match expected signature for this payload.");
    }
    return true;
};
exports.verifyWebhookSignature = verifyWebhookSignature;
/**
 * @deprecated This method is deprecated and will be removed in a future version. Please use verifyWebhookSignature instead.
 */
var verifySignature = function (_a) {
    var signatureHeader = _a.signatureHeader, secret = _a.secret, payload = _a.payload, _b = _a.tolerance, tolerance = _b === void 0 ? 300 : _b;
    if (!signatureHeader) {
        throw new Error("Please provide the ms-signature header");
    }
    var _c = __read(signatureHeader.split(' '), 2), t = _c[0], s = _c[1];
    var time = t.split('t=')[1];
    var signature = s.split('s=')[1];
    var expectedSignature = createSignature(secret, parseInt(time), payload);
    var compareSignatures = function (sig, expSig) {
        sig = Buffer.from(sig);
        expSig = Buffer.from(expSig);
        if (sig.length !== expSig.length) {
            return false;
        }
        if (crypto_1.default.timingSafeEqual) {
            return crypto_1.default.timingSafeEqual(sig, expSig);
        }
        var result = 0;
        for (var i = 0; i < sig.length; ++i) {
            result |= sig[i] ^ expSig[i];
        }
        return result === 0;
    };
    var isEqual = compareSignatures(signature, expectedSignature);
    if (!isEqual) {
        throw new Error("The signature did not match expected signature for this payload.");
    }
    var timestampAge = (Date.now() - parseInt(time)) / 1000;
    if (tolerance > 0 && timestampAge > tolerance) {
        throw new Error("The signature's timestamp is outside the tolerance zone.");
    }
    return true;
};
exports.verifySignature = verifySignature;
