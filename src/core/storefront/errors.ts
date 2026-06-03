// Owner: @BE | Scope: Storefront error types

/**
 * Thrown when a Shopify storefront lands on /password and the persistent
 * `storefront-profile/` doesn't have a valid gate-bypass cookie for this store.
 * Caller should `instanceof` and skip cleanly with a "run storefront:login"
 * diagnostic.
 */
export class StorefrontProtectedError extends Error {
  constructor(public readonly handle: string) {
    super(
      `Storefront ${handle} hit /password — run: npm run storefront:login -- ${handle}`,
    );
    this.name = 'StorefrontProtectedError';
  }
}
