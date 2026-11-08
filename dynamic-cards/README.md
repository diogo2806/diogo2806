# Cartões automáticos do portfólio

Serviço HTTP de SVGs para os 16 projetos privados descritos em `../portfolio.json`.
As estatísticas são consultadas no GitHub, no servidor, sem GitHub Actions.

Cada projeto mostra commits no histórico da `main`, commits nos últimos 30 dias,
último commit e horário da consulta. Os totais abrangem todos os autores,
merges e automações; não representam apenas autoria de Diogo.

## Implantação no EasyPanel

- Projeto: `pessoal`; serviço: `github-profile-cards`.
- Origem: `diogo2806/diogo2806`, branch `main`, diretório `/`.
- Build: Dockerfile `dynamic-cards/Dockerfile`, contexto na raiz do repositório.
- Porta interna: `8080`; health check: `/healthz`.
- Variável secreta obrigatória: `GITHUB_TOKEN`, preenchida no ambiente do serviço.
- Prontidão dos dados: `/readyz`; deve retornar HTTP 200 e `ready: true`.

Use um fine-grained personal access token do proprietário `diogo2806`, com
acesso **somente aos 16 repositórios do portfólio** e permissão de repositório
**Contents: read-only**. Metadata de leitura é incluída automaticamente.
Não são necessárias permissões de escrita, Actions, issues ou administração.
O token não deve entrar no README, em URLs, commits ou mensagens de chat.
Quando ele expirar ou for revogado, as consultas param e a prontidão indica falha.

Repositórios selecionados: CloudPort, praxis, aia-champions, iClinicaDx, krino,
unihub, guardiao, khora, Prancheta, iforce-billing, borainteragir, InfluConnect,
iforce-comercial, S3gram, iforce-mail e lastro.

## Funcionamento

- Uma consulta GraphQL reúne somente contagens e datas dos 16 projetos.
- Atualização em segundo plano a cada 30 minutos; nova tentativa em 60 segundos
  quando houver falha. Cache local expira após uma hora.
- As imagens têm cache HTTP de 15 minutos. O cache de imagens do GitHub pode
  acrescentar atraso; não há promessa de atualização instantânea.
- Rotas aceitas: `/rows/01.svg` até `/rows/08.svg`, com variantes `-mobile.svg`.
- As requisições das imagens não disparam consultas ao GitHub; não aceitam
  repositórios ou destinos arbitrários e nunca retornam a credencial.
- Sem acesso válido ou com dados expirados, a área de métricas informa
  `Estatísticas indisponíveis`, preservando a apresentação do projeto.

## Ativação no perfil

Somente depois de configurar a credencial e validar a prontidão, executar:

```sh
node dynamic-cards/activate.mjs https://DOMINIO-REAL-DO-SERVICO
```

O script verifica os dados dos 16 projetos e as 16 imagens antes de alterar o
README local. Publicar essa alteração e conferir a exibição pelo GitHub.
Até a ativação, o perfil mantém os cartões atuais.

## Validação local

Node.js 22+, sem dependências npm:

```sh
node --test dynamic-cards/server.test.mjs
node dynamic-cards/server.mjs
```

O build Docker executa os mesmos testes. Não existem dados simulados no serviço.
Os dados de contrato usados pelos testes ficam apenas em `server.test.mjs`.

Fontes: [schema de commits](https://docs.github.com/en/graphql/reference/commits),
[tokens com acesso restrito](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens).
