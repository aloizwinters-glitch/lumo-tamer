import { Router, Request, Response } from "express";
import { getReasoningConfig, getServerConfig } from "../../app/config.js";
import {
  advertisedModelIds,
  effectiveExtras,
} from "../../lumo-client/model-tier.js";
import { MODELS } from "../../app/const.js";

function modelCard(id: string) {
  return {
    id,
    object: "model" as const,
    created: MODELS.CREATED_EPOCH,
    owned_by: "proton",
    context_window: MODELS.CONTEXT_WINDOW,
    max_tokens: MODELS.MAX_OUTPUT_TOKENS,
  };
}

export function createModelsRouter(): Router {
  const router = Router();
  const serverConfig = getServerConfig();
  const advertised = advertisedModelIds(
    serverConfig.allowedModels,
    effectiveExtras(
      serverConfig.allowedModels,
      serverConfig.extraModels,
      getReasoningConfig().autoVariants,
    ),
  );

  router.get("/v1/models", (_req: Request, res: Response) => {
    res.json({
      object: "list",
      data: advertised.map(modelCard),
    });
  });

  router.get("/v1/models/:id", (req: Request, res: Response) => {
    const id = decodeURIComponent(
      Array.isArray(req.params.id) ? req.params.id[0] : req.params.id,
    );
    const allowed = advertised;
    const match = allowed.find((m) => m === id || m === id.split("/").pop());
    if (!match) {
      res.status(404).json({
        error: {
          message: `The model '${id}' does not exist`,
          type: "invalid_request_error",
          code: "model_not_found",
        },
      });
      return;
    }
    res.json(modelCard(match));
  });

  return router;
}
