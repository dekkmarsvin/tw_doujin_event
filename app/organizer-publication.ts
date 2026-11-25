/** A publication refusal: `retryable` says whether approving again can succeed. */
export class PublicationFailure extends Error {
  constructor(public code: string, message: string, public retryable: boolean) { super(message); }
}
