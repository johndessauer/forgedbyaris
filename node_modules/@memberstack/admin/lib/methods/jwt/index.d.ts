export declare const verifyToken: ({ token, audience }: {
    token: string;
    audience?: string;
}) => Promise<Pick<import("jose").JWTPayload, "iat" | "exp"> & {
    id: string;
    type: "member";
}>;
