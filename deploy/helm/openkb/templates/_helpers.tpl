{{- define "openkb.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "openkb.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "openkb.labels" -}}
app.kubernetes.io/name: {{ include "openkb.name" . }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "openkb.selectorLabels" -}}
app.kubernetes.io/name: {{ include "openkb.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "openkb.image" -}}
{{- printf "%s:%s" .Values.image.repository .Values.image.tag -}}
{{- end -}}

{{- define "openkb.configName" -}}
{{- printf "%s-config" (include "openkb.fullname" .) -}}
{{- end -}}

{{- define "openkb.secretName" -}}
{{- default (printf "%s-secret" (include "openkb.fullname" .)) .Values.secrets.existingSecret -}}
{{- end -}}

{{- define "openkb.postgresHost" -}}
{{- if .Values.postgres.external -}}
{{- .Values.postgres.host -}}
{{- else -}}
{{- printf "%s-postgres" (include "openkb.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "openkb.redisHost" -}}
{{- if .Values.redis.external -}}
{{- .Values.redis.host -}}
{{- else -}}
{{- printf "%s-redis" (include "openkb.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "openkb.redisUrl" -}}
{{- printf "redis://%s:%v" (include "openkb.redisHost" .) .Values.redis.port -}}
{{- end -}}

{{- define "openkb.s3Endpoint" -}}
{{- if .Values.s3.external -}}
{{- .Values.s3.endpoint -}}
{{- else -}}
{{- printf "http://%s-minio-assets:%v" (include "openkb.fullname" .) .Values.s3.minio.service.port -}}
{{- end -}}
{{- end -}}

{{- define "openkb.milvusUri" -}}
{{- if eq .Values.milvus.mode "external" -}}
{{- .Values.milvus.uri -}}
{{- else -}}
{{- printf "%s-milvus-standalone:19530" (include "openkb.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "openkb.databaseUrl" -}}
{{- if .Values.postgres.databaseUrl -}}
{{- .Values.postgres.databaseUrl -}}
{{- else -}}
{{- printf "postgresql://%s:%s@%s:%v/%s?schema=public" .Values.postgres.username .Values.secrets.postgresPassword (include "openkb.postgresHost" .) .Values.postgres.port .Values.postgres.database -}}
{{- end -}}
{{- end -}}

