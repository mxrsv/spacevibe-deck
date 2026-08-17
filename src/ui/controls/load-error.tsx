interface LoadErrorProps {
  readonly message: string;
  readonly onRetry: () => void;
}

/** Persistent, compact recovery row for a resource whose last read failed. */
export function LoadError({ message, onRetry }: LoadErrorProps) {
  return (
    <div class="load-error" role="alert">
      <span class="load-error__message">{message}</span>
      <button type="button" class="load-error__retry" onClick={onRetry}>
        retry
      </button>
    </div>
  );
}
