import { GmailApprovedMessageSchema, type GmailApprovedMessage } from "@/lib/contracts/provider-ports";
import { GmailActionKeySchema, type GmailActionKey } from "@/lib/contracts/gmail-delivery";

export const GmailTemplateIdSchema = GmailActionKeySchema;
export type GmailTemplateId = GmailActionKey;

export class GmailTemplateValidationError extends Error {
  readonly code = "unknown_template" as const;

  constructor() {
    super("The approved Gmail message does not match a registered Rewind template.");
    this.name = "GmailTemplateValidationError";
  }
}

function expectedSubject(templateId: GmailTemplateId, runId: string): string {
  if (templateId === "initial.mail.notify") return `[Rewind ${runId}] Acme UK renewal moved`;
  if (templateId === "recovery.mail.correct_uk") return `[Rewind ${runId}] Correction: Acme UK renewal`;
  return `[Rewind ${runId}] Acme US renewal moved`;
}

function bodyMatches(templateId: GmailTemplateId, body: string): boolean {
  if (templateId === "recovery.mail.correct_uk") {
    return body === "Correction: the Acme UK renewal was restored to its original scheduled time.";
  }
  const region = templateId === "initial.mail.notify" ? "UK" : "US";
  return new RegExp(`^The Acme ${region} renewal is now scheduled for \\d{4}-\\d{2}-\\d{2} at (?:[01]\\d|2[0-3]):[0-5]\\d ET\\.$`).test(body);
}

/** Validate the closed scenario template before any dispatch state is claimed. */
export function assertRegisteredGmailTemplate(templateId: GmailTemplateId, input: GmailApprovedMessage): GmailApprovedMessage {
  const parsedTemplate = GmailTemplateIdSchema.parse(templateId);
  const message = GmailApprovedMessageSchema.parse(input);
  if (message.subject.includes("\r") || message.subject.includes("\n")) throw new GmailTemplateValidationError();
  if (message.subject !== expectedSubject(parsedTemplate, message.runId) || !bodyMatches(parsedTemplate, message.bodyText)) {
    throw new GmailTemplateValidationError();
  }
  return message;
}
