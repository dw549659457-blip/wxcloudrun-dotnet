import { useEffect, useRef, useState } from 'react';
import {
  ApiError,
  confirmSubmission,
  friendlyError,
  makeTicket,
  type SubmissionResult,
  type SubmissionTicket,
} from '@warehouse/contracts';
import { api } from '../api/client';
import { useAuth } from './useAuth';
function storedTicket(key: string): SubmissionTicket | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (
      typeof value === 'object' &&
      value !== null &&
      'key' in value &&
      typeof value.key === 'string' &&
      'operation' in value &&
      typeof value.operation === 'string' &&
      'path' in value &&
      typeof value.path === 'string' &&
      'body' in value
    ) {
      return value as SubmissionTicket;
    }
  } catch {
    sessionStorage.removeItem(key);
  }
  return null;
}
export function useSubmission(scope: string, onSuccess: (result: SubmissionResult) => void) {
  const { user } = useAuth();
  const storageKey = `warehouse:submission:${user?.id}:${scope}`;
  const [ticket, setTicket] = useState<SubmissionTicket | null>(() => storedTicket(storageKey));
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<unknown>(null);
  const inFlight = useRef(false);
  const pending = useRef(ticket);
  useEffect(() => {
    const restored = storedTicket(storageKey);
    pending.current = restored;
    setTicket(restored);
    setMessage('');
    setError(null);
  }, [storageKey]);
  async function perform(current: SubmissionTicket) {
    if (inFlight.current) {
      return;
    }
    inFlight.current = true;
    pending.current = current;
    setLoading(true);
    setError(null);
    setMessage('');
    setTicket(current);
    sessionStorage.setItem(storageKey, JSON.stringify(current));
    try {
      const outcome = await confirmSubmission(api, current);
      if (outcome.state === 'succeeded') {
        sessionStorage.removeItem(storageKey);
        pending.current = null;
        setTicket(null);
        onSuccess(outcome.result);
      } else {
        setMessage(outcome.message);
      }
    } catch (failure) {
      setError(failure);
      if (failure instanceof ApiError && failure.status > 0 && failure.status < 500) {
        sessionStorage.removeItem(storageKey);
        pending.current = null;
        setTicket(null);
      }
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }
  async function submit(operation: string, path: string, body: unknown) {
    if (pending.current) {
      setMessage('请先确认原提交结果，避免重复记账');
      return;
    }
    await perform(makeTicket(operation, path, body));
  }
  async function retry() {
    if (pending.current) {
      await perform(pending.current);
    }
  }
  return {
    submit,
    retry,
    pending: ticket !== null,
    loading,
    message,
    error,
    errorMessage: error ? friendlyError(error) : '',
  };
}
