import { describe, expect, it } from "vitest";
import { GmailProviderError, type GmailPort } from "@/lib/adapters/gmail";
import { GmailSendReceiptSchema, type GmailApprovedMessage, type GmailSendReceipt } from "@/lib/contracts/provider-ports";
import { MemoryGmailDispatchStore } from "@/lib/db/gmail-dispatch";
import { sha256Text } from "@/lib/domain/digest";
import { GmailDeliveryService, type GmailDeliveryRequest } from "@/lib/services/gmail-delivery";

const fixedTime = new Date("2026-07-16T10:00:00.000Z");
const allowlist = { UK: ["uk-ops@example.test"], US: ["us-ops@example.test"] };
const body = "The Acme UK renewal is now scheduled for 2026-08-20 at 15:00 ET.";
const message: GmailApprovedMessage = {
  senderGoogleSub: "google-subject",
  to: ["uk-ops@example.test"],
  subject: "[Rewind run_s037_001] Acme UK renewal moved",
  bodyText: body,
  bodyHash: sha256Text(body),
  runId: "run_s037_001",
};

function request(overrides: Partial<GmailDeliveryRequest> = {}): GmailDeliveryRequest {
  return {
    actionId: "action_s037_001",
    planId: "plan_s037_001",
    actionKey: "initial.mail.notify",
    approvedPlanDigest: sha256Text("approved-plan"),
    currentPlanDigest: sha256Text("approved-plan"),
    expectedSenderGoogleSub: "google-subject",
    message,
    allowlist,
    ...overrides,
  };
}

class RecordingPort implements GmailPort {
  attempts = 0;
  preparations = 0;
  constructor(private readonly outcome: GmailSendReceipt | Error = { status: "sent", messageId: "gmail-message-s037" }) {}

  prepareApprovedMessage(): void {
    this.preparations += 1;
    if (this.outcome instanceof GmailProviderError) throw this.outcome;
  }

  async sendApprovedMessage(): Promise<GmailSendReceipt> {
    this.attempts += 1;
    if (this.outcome instanceof Error) throw this.outcome;
    return GmailSendReceiptSchema.parse(this.outcome);
  }
}

describe("S037 Gmail at-most-once delivery", () => {
  it("persists the dispatch marker before handoff and replays a sent receipt without a second call", async () => {
    const store = new MemoryGmailDispatchStore();
    const port = new RecordingPort();
    const service = new GmailDeliveryService(port, store, () => fixedTime);

    const first = await service.send(request());
    const row = await store.read("action_s037_001");
    const replay = await service.send(request());

    expect(first).toMatchObject({ status: "sent", replay: false, dispatchStartedAt: fixedTime.toISOString() });
    expect(replay).toMatchObject({ status: "sent", replay: true, dispatchStartedAt: fixedTime.toISOString() });
    expect(port.preparations).toBe(1);
    expect(port.attempts).toBe(1);
    expect(row).toMatchObject({ status: "succeeded", dispatchStartedAt: fixedTime.toISOString(), receipt: { messageId: "gmail-message-s037" } });
  });

  it("records local preparation failure as retryable with no marker, then permits one controlled retry", async () => {
    const store = new MemoryGmailDispatchStore();
    const local = new RecordingPort(new GmailProviderError());
    const failed = await new GmailDeliveryService(local, store, () => fixedTime).send(request());
    const failedRow = await store.read("action_s037_001");

    const successful = new RecordingPort();
    const retried = await new GmailDeliveryService(successful, store, () => fixedTime).send(request());

    expect(failed).toMatchObject({ status: "retryable_failed", dispatchStartedAt: null });
    expect(failedRow).toMatchObject({ status: "retryable_failed", dispatchStartedAt: null, errorCode: "local_preparation_failed" });
    expect(local.attempts).toBe(0);
    expect(retried).toMatchObject({ status: "sent", replay: false });
    expect(successful.attempts).toBe(1);
  });

  it.each([
    ["explicit permanent 4xx", { status: "permanent_failed", providerCode: "http_403" } as GmailSendReceipt],
    ["provider 408", { status: "delivery_uncertain", reason: "provider_408" } as GmailSendReceipt],
    ["provider 429", { status: "delivery_uncertain", reason: "provider_429" } as GmailSendReceipt],
    ["provider 5xx", { status: "delivery_uncertain", reason: "provider_5xx" } as GmailSendReceipt],
    ["transport timeout", { status: "delivery_uncertain", reason: "transport_timeout" } as GmailSendReceipt],
    ["transport cancellation", { status: "delivery_uncertain", reason: "cancellation" } as GmailSendReceipt],
  ])("stores %s and never auto-resends it", async (_label, outcome) => {
    const store = new MemoryGmailDispatchStore();
    const port = new RecordingPort(outcome);
    const service = new GmailDeliveryService(port, store, () => fixedTime);

    const first = await service.send(request());
    const replay = await service.send(request());

    expect(first.replay).toBe(false);
    expect(replay.replay).toBe(true);
    expect(replay.status).toBe(first.status);
    expect(port.attempts).toBe(1);
  });

  it("classifies a post-marker exception and malformed provider success as uncertain", async () => {
    const thrownStore = new MemoryGmailDispatchStore();
    const thrownPort = new RecordingPort(new Error("connection lost"));
    const thrown = await new GmailDeliveryService(thrownPort, thrownStore, () => fixedTime).send(request());
    expect(thrown).toMatchObject({ status: "delivery_uncertain", receipt: { reason: "transport_error" } });

    const malformedStore = new MemoryGmailDispatchStore();
    const malformedPort = new RecordingPort({ status: "sent", messageId: "" } as GmailSendReceipt);
    const malformed = await new GmailDeliveryService(malformedPort, malformedStore, () => fixedTime).send(request());
    expect(malformed).toMatchObject({ status: "delivery_uncertain", receipt: { reason: "malformed_success" } });
    expect((await new GmailDeliveryService(malformedPort, malformedStore, () => fixedTime).send(request())).replay).toBe(true);
    expect(malformedPort.attempts).toBe(1);
  });

  it("rejects plan drift, sender drift, unknown templates, and unallowlisted recipients before claim", async () => {
    const store = new MemoryGmailDispatchStore();
    const port = new RecordingPort();
    const service = new GmailDeliveryService(port, store, () => fixedTime);
    await expect(service.send(request({ currentPlanDigest: sha256Text("different-plan") }))).rejects.toMatchObject({ code: "plan_digest_mismatch" });
    await expect(service.send(request({ expectedSenderGoogleSub: "other-subject" }))).rejects.toMatchObject({ code: "sender_not_allowed" });
    await expect(service.send(request({ message: { ...message, subject: "not-approved" } }))).rejects.toMatchObject({ code: "unknown_template" });
    await expect(service.send(request({ message: { ...message, to: ["outside@example.test"] } }))).rejects.toMatchObject({ code: "recipient_not_allowed" });
    expect(port.preparations).toBe(0);
    expect(port.attempts).toBe(0);
    await expect(store.read("action_s037_001")).resolves.toBeNull();
  });

  it("does not dispatch a second time while another attempt has already persisted its marker", async () => {
    const store = new MemoryGmailDispatchStore();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => { release = resolve; });
    class SlowPort extends RecordingPort {
      override async sendApprovedMessage(): Promise<GmailSendReceipt> {
        this.attempts += 1;
        await waiting;
        return { status: "sent", messageId: "gmail-message-s037-slow" };
      }
    }
    const port = new SlowPort();
    const service = new GmailDeliveryService(port, store, () => fixedTime);
    const first = service.send(request());
    await Promise.resolve();
    const replay = await service.send(request());
    release();
    const sent = await first;

    expect(replay).toMatchObject({ status: "delivery_uncertain", replay: true, receipt: { reason: "process_interrupted" } });
    expect(sent).toMatchObject({ status: "sent", replay: false });
    expect(port.attempts).toBe(1);
  });
});
