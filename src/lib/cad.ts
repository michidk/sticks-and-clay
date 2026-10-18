import { z } from "zod";
export const cadRequirement = z.object({
  name: z.string().min(1).max(160),
  kind: z.enum(["x", "y", "z", "volume", "solid_count", "bore_count", "bore_diameter"]),
  value: z.number().finite().min(0).max(1e12),
  tolerance: z.number().finite().min(0).max(1e6),
  required: z.boolean(),
});
export const cadSpecResult = z.object({
  plan: z.string().min(1).max(12000),
  assumptions: z.array(z.string().max(1000)).max(30),
  requirements: z.array(cadRequirement).max(50),
});
export const cadBuildResult = z.object({ script: z.string().min(10).max(200000), notes: z.string().max(4000) });
