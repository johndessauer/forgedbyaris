export declare const verifyWebhookSignature: ({ headers, secret, payload, tolerance }: {
    headers: object;
    secret: string;
    payload: object;
    tolerance?: number;
}) => boolean;
/**
 * @deprecated This method is deprecated and will be removed in a future version. Please use verifyWebhookSignature instead.
 */
export declare const verifySignature: ({ signatureHeader, secret, payload, tolerance }: {
    signatureHeader: string;
    secret: string;
    payload: object;
    tolerance?: number;
}) => boolean;
