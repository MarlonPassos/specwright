/** Fragments reused across workflow bodies so every command states them identically. */

export const CLI_NOTE = [
  'Todos os comandos abaixo são da CLI `specs`. Rode de qualquer lugar dentro do projeto:',
  'a CLI encontra o workspace subindo a partir do diretório de trabalho.',
  '',
  'Todo comando que imprime JSON o faz no stdout como um único documento. Faça o parse -',
  'nunca deduza um caminho, um estado ou um id de artefato da saída legível.',
].join('\n');

export const RESOLVE_CHANGE = [
  '**Resolvendo a change**',
  '',
  'Se o usuário nomeou uma change, use ela. Caso contrário rode `specs list --json` e:',
  '- exatamente uma change ativa: use ela, e diga qual escolheu;',
  '- várias: pergunte ao usuário qual delas;',
  '- nenhuma: diga isso e pare.',
].join('\n');

export const PLANNING_BOUNDARY = [
  '**Limite de planejamento**: este comando produz apenas artefatos de planejamento. O pedido',
  'que o disparou autoriza planejar, mesmo quando vem escrito como "implemente" ou "corrija".',
  'Não edite o código do projeto e não comece a implementar. Quando os artefatos estiverem',
  'prontos, pare e espere um novo pedido.',
].join('\n');

export const PROJECT_BOUNDARY = [
  '**Limite macro**: este comando trabalha o PLANO do projeto, nunca uma change.',
  'Não escreva código. Não crie nem edite proposal.md, design.md, specs/**/spec.md',
  'ou tasks.md. Não rode `specs new change`. Quando o plano indicar o próximo',
  'incremento, aponte o usuário para {{spec-command:explore}} ou',
  '{{spec-command:propose}} e pare.',
].join('\n');

export const PLAN_WRITE_PROTOCOL = [
  '**Como escrever no plano**',
  '',
  'Você NUNCA edita `plan.yaml`, um Planned Change ou o bloco projetado de',
  '`plan.md` diretamente. Toda escrita passa pela CLI:',
  '',
  '1. Leia o estado: `specs project status --json`. Guarde `plan.revision`.',
  '2. Para mudar estrutura, monte um bundle JSON com `expectRevision` igual ao',
  '   `revision` que você leu e rode `specs project apply --dry-run --json`.',
  '3. Para materializar documentos, rode',
  '   `specs project generate --milestone <id> --dry-run --json`.',
  '4. Mostre ao usuário o que mudaria e o impacto que o comando devolveu.',
  '5. Faça UMA pergunta direta de sim ou não e espere a confirmação em uma',
  '   mensagem separada. A confirmação vale só para o escopo mostrado.',
  '6. Depois do sim, rode o mesmo comando sem `--dry-run`.',
  '7. Se vier `plan_revision_conflict`, recarregue o estado e repita do passo 1.',
  '8. Se vier `planned_change_modified`, NÃO use `--force` por conta própria:',
  '   mostre o conflito e pergunte.',
  '9. Feche com `specs project validate --strict --json` e reporte o resultado.',
].join('\n');

export const EVIDENCE_LABELS = [
  '**Rotule a origem de cada afirmação**',
  '',
  '- **Fato**: algo que você leu no filesystem ou em uma saída `--json`.',
  '- **Cálculo**: um resultado determinístico que a CLI devolveu, como readiness,',
  '  recomendação ou impacto estrutural.',
  '- **Recomendação**: sua leitura do problema. Não a apresente como verificada.',
].join('\n');

export const PROJECT_GUARDRAILS = [
  '## Guardrails',
  '',
  '1. Não implementar código; não criar nem editar artefatos de change; não rodar `specs new change`.',
  '2. Não detalhar incrementos distantes — elaboração progressiva.',
  '3. Consultar estado sempre por `--json`; nunca deduzir de texto formatado.',
  '4. Preview antes de qualquer mutação; confirmação em mensagem separada antes da primeira escrita.',
  '5. Nunca alterar um incremento concluído; recomendar uma change corretiva nova.',
  '6. Rotular fato, cálculo e recomendação.',
  '7. Registrar incerteza genuína em `Riscos`, `Notas para exploração` ou nas decisões de',
  '   `architecture.md`; nunca chutar uma decisão que muda escopo.',
  '8. Nunca copiar conteúdo de documento-fonte para o plano.',
].join('\n');

export const ARTIFACT_RULES = [
  '**Escrevendo um artefato**',
  '',
  '1. Peça as instruções dele à CLI:',
  '   ```bash',
  '   specs instructions <id-do-artefato> --change "<change>" --json',
  '   ```',
  '2. A resposta carrega:',
  '   - `instruction` - a orientação definitiva para este tipo de artefato;',
  '   - `template` - a estrutura a preencher;',
  '   - `context` e `rules` - restrições para VOCÊ. Nunca copie para dentro do arquivo;',
  '   - `outputPath` - onde o artefato vai. Quando `outputIsPattern` é true, o caminho é um',
  '     padrão e `instruction` diz como escolher os nomes concretos dos arquivos;',
  '   - `dependencies` - artefatos a ler antes, com os arquivos que os contêm;',
  '   - `skipped` e `warning` - presentes quando a change abriu mão deste artefato.',
  '     Não o crie; escolha outro.',
  '3. Leia cada arquivo de dependência do disco antes de escrever, mesmo que já o tenha visto -',
  '   o usuário pode tê-lo editado desde então.',
  '4. Escreva o arquivo em `outputPath` seguindo `template` e `instruction`.',
  '5. Confirme que o arquivo existe antes de seguir em frente.',
].join('\n');
