"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { errorMessage, portalApi, type LicenceRequest } from "./portal-api";

function when(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function RequestCard({
  request,
  onChanged,
}: {
  request: LicenceRequest;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-2 p-3 text-sm">
        <div>
          <p className="font-medium text-text">
            {request.name}, {request.company}
          </p>
          <a className="break-all text-accent underline" href={`mailto:${request.email}`}>
            {request.email}
          </a>
          <p className="text-sub">
            {when(request.created_at)}
            {request.handled_at ? `, handled ${when(request.handled_at)}` : ""}
          </p>
        </div>
        <dl className="space-y-1">
          <div>
            <dt className="font-medium text-text">Intended use</dt>
            <dd className="whitespace-pre-wrap break-words text-sub">{request.intended_use}</dd>
          </div>
          <div>
            <dt className="font-medium text-text">Team size</dt>
            <dd className="break-words text-sub">{request.team_size}</dd>
          </div>
          {request.message ? (
            <div>
              <dt className="font-medium text-text">Message</dt>
              <dd className="whitespace-pre-wrap break-words text-sub">{request.message}</dd>
            </div>
          ) : null}
        </dl>
        {error ? (
          <p role="alert" className="text-danger">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => run(() => portalApi.markHandled(request.id, !request.handled_at))}
          >
            {request.handled_at ? "Mark as not handled" : "Mark handled"}
          </Button>
          <Button
            type="button"
            variant="danger-ghost"
            disabled={busy}
            onClick={() => {
              if (
                !window.confirm(`Delete the request from ${request.name}? This can't be undone.`)
              ) {
                return;
              }
              void run(() => portalApi.deleteRequest(request.id));
            }}
          >
            Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** Licence requests wait here: the toolkit has no mail service to send them on. */
export function LicenceView({
  requests,
  loadError,
  onChanged,
}: {
  requests: LicenceRequest[] | null;
  loadError: string | null;
  onChanged: () => Promise<void>;
}) {
  if (loadError) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p className="text-danger">{loadError}</p>
        <Button type="button" variant="outline" onClick={() => void onChanged()}>
          Try again
        </Button>
      </div>
    );
  }
  if (!requests) return <p className="text-sm text-sub">Loading requests…</p>;

  const waiting = requests.filter((r) => !r.handled_at);
  const handled = requests.filter((r) => r.handled_at);
  return (
    <div className="space-y-4">
      {waiting.length === 0 ? <p className="text-sm text-sub">No requests waiting.</p> : null}
      {waiting.map((request) => (
        <RequestCard key={request.id} request={request} onChanged={onChanged} />
      ))}
      {handled.length > 0 ? (
        <details className="rounded-lg border border-border p-3">
          <summary className="min-h-11 cursor-pointer py-2 font-medium text-text">
            Handled ({handled.length})
          </summary>
          <div className="mt-2 space-y-2">
            {handled.map((request) => (
              <RequestCard key={request.id} request={request} onChanged={onChanged} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
