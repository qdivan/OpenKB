import { Module } from "@nestjs/common";
import { AuthService } from "@openkb/auth";
import { PermissionService } from "@openkb/permissions";

import { AdminController } from "./auth/admin.controller";
import { AuthController } from "./auth/auth.controller";
import { AssetController } from "./content/asset.controller";
import { CollaborationController } from "./content/collaboration.controller";
import { ContentService } from "./content/content.service";
import { DocumentController } from "./content/document.controller";
import { ImportJobController } from "./content/import-job.controller";
import { ImportService } from "./content/import.service";
import { KnowledgeBaseController } from "./content/knowledge-base.controller";
import { ShareController } from "./content/share.controller";
import { UploadController } from "./content/upload.controller";
import { WorkspaceController } from "./content/workspace.controller";
import { HealthController } from "./health.controller";

@Module({
  controllers: [
    HealthController,
    AuthController,
    AdminController,
    WorkspaceController,
    KnowledgeBaseController,
    DocumentController,
    UploadController,
    AssetController,
    ImportJobController,
    CollaborationController,
    ShareController
  ],
  providers: [AuthService, PermissionService, ContentService, ImportService]
})
export class AppModule {}
