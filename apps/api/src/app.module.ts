import { Module } from "@nestjs/common";
import { AuthService } from "@openkb/auth";
import { PermissionService } from "@openkb/permissions";
import { RetrievalService } from "@openkb/retrieval";

import { AdminController } from "./auth/admin.controller";
import { AuthController } from "./auth/auth.controller";
import { AssetController } from "./content/asset.controller";
import { ChunkRebuildJobController } from "./content/chunk-rebuild-job.controller";
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
import { MilvusAdminController } from "./milvus/milvus-admin.controller";
import { MilvusAdminService } from "./milvus/milvus-admin.service";
import { ModelSettingsAdminController } from "./models/model-settings-admin.controller";
import { ModelSettingsAdminService } from "./models/model-settings-admin.service";
import { RetrievalSettingsAdminController } from "./retrieval/retrieval-settings-admin.controller";
import { RetrievalSettingsAdminService } from "./retrieval/retrieval-settings-admin.service";
import { SearchController } from "./search/search.controller";

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
    ChunkRebuildJobController,
    ImportJobController,
    CollaborationController,
    ShareController,
    MilvusAdminController,
    ModelSettingsAdminController,
    RetrievalSettingsAdminController,
    SearchController
  ],
  providers: [
    AuthService,
    PermissionService,
    ContentService,
    ImportService,
    MilvusAdminService,
    ModelSettingsAdminService,
    RetrievalSettingsAdminService,
    RetrievalService
  ]
})
export class AppModule {}
