import { test } from "node:test";
import assert from "node:assert/strict";
import { gerarTransacoes, separar, criarTreino, criarModelo, avaliar, auc, curvaROC, ATRIBUTOS, sigmoide } from "../modelo.js";

const dados = gerarTransacoes(10000, 42);
const { treino, teste } = separar(dados);

test("mesma semente gera os mesmos dados", () => {
  assert.deepEqual(gerarTransacoes(50, 1), gerarTransacoes(50, 1));
  assert.notDeepEqual(gerarTransacoes(50, 1), gerarTransacoes(50, 2));
});

test("fraude é rara, como na vida real (entre 2% e 7%)", () => {
  const taxa = dados.filter(t => t.fraude).length / dados.length;
  assert.ok(taxa > 0.02 && taxa < 0.07, `taxa de fraude ${taxa}`);
});

test("treino e teste não se misturam e somam tudo", () => {
  assert.equal(treino.length + teste.length, dados.length);
  const ids = new Set(treino.map(t => t.id));
  assert.ok(teste.every(t => !ids.has(t.id)));
});

test("o erro cai durante o treino", () => {
  const tr = criarTreino(treino);
  const inicio = tr.passo(1);
  for (let i = 0; i < 100; i++) tr.passo(1);
  assert.ok(tr.passo(1) < inicio * 0.85);
});

test("o modelo treinado separa bem fraudes de compras boas (AUC > 0,85 em dados que ele nunca viu)", () => {
  const tr = criarTreino(treino);
  tr.passo(300);
  const modelo = tr.modelo();
  const p = teste.map(t => modelo.prever(t));
  assert.ok(auc(teste, p) > 0.85, `AUC ${auc(teste, p)}`);
  assert.ok(avaliar(teste, p, 0.5).recall > 0.7);
});

test("o modelo aprende os sinais certos: tentativas e e-mail descartável aumentam o risco", () => {
  const tr = criarTreino(treino);
  tr.passo(300);
  const pesos = Object.fromEntries(tr.modelo().importancia().map(x => [x.nome, x.peso]));
  assert.ok(pesos["Tentativas com o cartão em 24h"] > 0);
  assert.ok(pesos["E-mail descartável"] > 0);
  assert.ok(pesos["Compras anteriores"] < 0);
});

test("as explicações somam exatamente o risco previsto", () => {
  const tr = criarTreino(treino);
  tr.passo(50);
  const modelo = tr.modelo();
  for (const tx of teste.slice(0, 20)) {
    const soma = modelo.explicar(tx).reduce((s, e) => s + e.efeito, modelo.b);
    assert.ok(Math.abs(sigmoide(soma) - modelo.prever(tx)) < 1e-9);
  }
});

test("métricas conferem num exemplo feito à mão", () => {
  const lista = [{ fraude: true, valor: 100 }, { fraude: true, valor: 50 }, { fraude: false, valor: 30 }, { fraude: false, valor: 20 }];
  const m = avaliar(lista, [0.9, 0.2, 0.8, 0.1], 0.5);
  assert.deepEqual([m.vp, m.fn, m.fp, m.vn], [1, 1, 1, 1]);
  assert.equal(m.precisao, 0.5);
  assert.equal(m.recall, 0.5);
  assert.equal(m.barrado, 100);
  assert.equal(m.escapou, 50);
  assert.equal(m.bloqueouBom, 30);
});

test("AUC: 1 quando ordena perfeito, 0,5 quando tudo empata", () => {
  const lista = [{ fraude: true }, { fraude: false }, { fraude: true }, { fraude: false }];
  assert.equal(auc(lista, [0.9, 0.1, 0.8, 0.2]), 1);
  assert.equal(auc(lista, [0.5, 0.5, 0.5, 0.5]), 0.5);
});

test("curva ROC vai de (0,0) a (1,1)", () => {
  const lista = [{ fraude: true }, { fraude: false }];
  const c = curvaROC(lista, [0.7, 0.3], 10);
  assert.deepEqual(c[0], { x: 0, y: 0 });
  assert.deepEqual(c.at(-1), { x: 1, y: 1 });
});

test("modelo salvo e recarregado prevê igual", () => {
  const tr = criarTreino(treino);
  tr.passo(20);
  const a = tr.modelo();
  const b = criarModelo(JSON.parse(JSON.stringify({ w: a.w, b: a.b, media: a.media, desvio: a.desvio })));
  assert.equal(a.prever(teste[0]), b.prever(teste[0]));
  assert.equal(a.w.length, ATRIBUTOS.length);
});
