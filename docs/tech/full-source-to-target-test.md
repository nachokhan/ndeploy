# Full Source-to-Target Test

Este documento sirve para probar un flujo completo desde cero de `source` a `target`, incluyendo configuración de profile, generación del project, fetch de credenciales, plan, apply y publish final.

## 1. Crear el profile

```bash
mkdir -p ~/.ndeploy
cat > ~/.ndeploy/profiles.json <<'EOF'
{
  "schema_version": 1,
  "profiles": {
    "source-to-prod": {
      "source": {
        "url": "https://SOURCE_N8N_URL",
        "api_key": "SOURCE_API_KEY",
        "credential_export_url": "https://SOURCE_N8N_URL/webhook/ndeploy/source/credential-export",
        "credential_export_token": "SOURCE_CREDENTIAL_EXPORT_TOKEN"
      },
      "target": {
        "url": "https://PROD_N8N_URL",
        "api_key": "PROD_API_KEY",
        "credential_export_url": "https://PROD_N8N_URL/webhook/ndeploy/source/credential-export",
        "credential_export_token": "PROD_CREDENTIAL_EXPORT_TOKEN"
      }
    }
  }
}
EOF
```

## 2. Compilar el CLI

```bash
npm install
npm run build
```

## 3. Verificar que responde

```bash
node dist/index.js --help
```

## 4. Crear un project nuevo desde el workflow root en source

```bash
node dist/index.js create <WORKFLOW_ID_SOURCE> ./projects --profile source-to-prod
```

## 5. Entrar al project creado

```bash
cd ./projects/<NOMBRE_DEL_PROJECT>
```

## 6. Verificar metadata inicial del project

```bash
node ../../dist/index.js info
cat project.json
```

## 7. Generar el plan source -> target

```bash
node ../../dist/index.js plan
```

## 8. Revisar artefactos generados

```bash
cat plan.json
cat reports/plan_summary.json
```

## 9. Obtener snapshots de credenciales

```bash
NDEPLOY_LOG_LEVEL=info node ../../dist/index.js credentials fetch --profile source-to-prod --side both
```

## 10. Revisar snapshots de credenciales

```bash
cat credentials_source.json
cat credentials_target.json
```

## 11. Comparar source vs target

```bash
node ../../dist/index.js credentials compare
```

## 12. Crear/completar el manifest editable de credenciales

```bash
node ../../dist/index.js credentials merge-missing
cat credentials_manifest.json
```

## 13. Validar el manifest

```bash
node ../../dist/index.js credentials validate --side manifest --strict
```

## 14. Aplicar el deploy en target

```bash
node ../../dist/index.js apply
```

## 15. Revisar resultado del deploy

```bash
cat reports/deploy_result.json
cat reports/deploy_summary.json
```

## 16. Publicar manualmente el workflow root en target

```bash
node ../../dist/index.js publish <WORKFLOW_ID_TARGET> --profile source-to-prod
```

## 17. Verificación final

```bash
node ../../dist/index.js info
```

## 18. Prueba manual opcional del webhook de credenciales source

```bash
curl -X POST "https://SOURCE_N8N_URL/webhook/ndeploy/source/credential-export" \
  -H "Content-Type: application/json" \
  -H "X-NDEPLOY-TOKEN: SOURCE_CREDENTIAL_EXPORT_TOKEN" \
  -d '{
    "credentials": [
      {
        "source_id": "CREDENTIAL_ID",
        "id": "CREDENTIAL_ID",
        "name": "Credential Name",
        "type": "credentialType"
      }
    ]
  }'
```

## 19. Prueba manual opcional del webhook de credenciales target

```bash
curl -X POST "https://PROD_N8N_URL/webhook/ndeploy/source/credential-export" \
  -H "Content-Type: application/json" \
  -H "X-NDEPLOY-TOKEN: PROD_CREDENTIAL_EXPORT_TOKEN" \
  -d '{
    "credentials": [
      {
        "source_id": "CREDENTIAL_ID",
        "id": "CREDENTIAL_ID",
        "name": "Credential Name",
        "type": "credentialType"
      }
    ]
  }'
```
