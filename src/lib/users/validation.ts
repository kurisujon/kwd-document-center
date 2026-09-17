import { z } from "zod";
import { roles, statuses } from "../auth/types";

export const managedUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  name: z.string(),
  role: z.enum(roles),
  status: z.enum(statuses),
  created_at: z.string(),
  updated_at: z.string(),
}).strict();

export const createUserSchema = z.object({
  email: z.string()
    .trim()
    .max(254, "Email must not exceed 254 characters.")
    .email("Enter a valid email address.")
    .transform((value) => value.toLowerCase()),
  name: z.string()
    .trim()
    .min(1, "Name is required.")
    .max(120, "Name must not exceed 120 characters."),
  role: z.enum(roles, { error: "Select a valid role." }),
}).strict();

export const updateUserSchema = z.object({
  role: z.enum(roles, { error: "Select a valid role." }).optional(),
  status: z.enum(statuses, { error: "Select a valid status." }).optional(),
}).strict().refine(
  (value) => value.role !== undefined || value.status !== undefined,
  { message: "Provide a role or status change." },
);

export const userIdSchema = z.string().uuid("User ID is invalid.");
