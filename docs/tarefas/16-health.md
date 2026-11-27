# 16 · health

**Objetivo:** saber se a API está de pé e pronta para atender. `/health` e `/ready` (com o banco) já existem.

**Depende de:** TRV-04, TRV-05, TRV-06.

---

### HLT-01 · Readiness com todas as dependências

**Estimativa:** P · **Marco:** Produção

- **Endpoints:** `GET /ready` (já existe).

**Critérios de aceite**

- [ ] Indicadores de Redis (`PING`), Vault (`sys/health`; selado conta como fora), storage (`HeadBucket`) e ClamAV
      (`PING`).
- [ ] `/health` continua sem tocar em nenhuma dependência (teste existente).

### HLT-02 · Métricas

**Estimativa:** M · **Marco:** Evolução

- **Endpoints:** `GET /metrics`, só na rede interna (não publicado no proxy).

**Critérios de aceite**

- [ ] `prom-client` com duração das requisições por rota (o modelo da rota, não a URL), tamanho das filas e
      resultado da última verificação da cadeia de auditoria.
- [ ] Nenhuma métrica com id de denúncia, protocolo ou usuário nos rótulos.
