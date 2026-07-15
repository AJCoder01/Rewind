import { z } from "zod";

/**
 * The callback query is parsed before any transaction lookup.  Provider error
 * descriptions are accepted only as bounded input and are never reflected in
 * a response or log.
 */
export const GoogleOAuthCallbackQuerySchema = z
  .object({
    state: z.string().min(1).max(512),
    code: z.string().min(1).max(8192).optional(),
    error: z.string().min(1).max(200).optional(),
    error_description: z.string().min(1).max(1000).optional(),
    error_uri: z.string().url().max(2000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.code) === Boolean(value.error)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["code"], message: "OAuth callback must contain exactly one code or provider error" });
    }
    if (!value.error && (value.error_description || value.error_uri)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["error_description"], message: "OAuth error details require a provider error" });
    }
  });

export type GoogleOAuthCallbackQuery = z.infer<typeof GoogleOAuthCallbackQuerySchema>;
