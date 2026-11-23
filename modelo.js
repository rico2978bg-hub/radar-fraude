// Radar de Fraude: o "cérebro" do projeto.
// Gera transações de exemplo, treina uma regressão logística do zero e mede o resultado.
// Sem bibliotecas: roda igual no navegador e no Node (para os testes).

export const CATEGORIAS = ["Moda", "Alimentos", "Serviços", "Eletrônicos", "Gift card"];

/* ---------- Números aleatórios com semente (mesma semente = mesmos dados) ---------- */
export function aleatorio(semente = 42) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const normal = r => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
export const sigmoide = z => 1 / (1 + Math.exp(-z));
function escolher(r, opcoes, pesos) {
  let x = r();
  for (let i = 0; i < opcoes.length; i++) { x -= pesos[i]; if (x <= 0) return opcoes[i]; }
  return opcoes.at(-1);
}

/* ---------- Dados sintéticos ---------- */
const VALOR_BASE = { Moda: 180, Alimentos: 90, Serviços: 150, Eletrônicos: 900, "Gift card": 250 };

// A "verdade escondida" que o modelo precisa descobrir sozinho só olhando os exemplos.
// Inclui uma combinação (IP de fora + dispositivo novo) e ruído, que o modelo não enxerga direto.
function riscoReal(tx, ruido) {
  return -5.9
    + 0.9 * (tx.categoria === "Gift card") + 0.6 * (tx.categoria === "Eletrônicos")
    + 0.6 * Math.log10(tx.valor / 100)
    + 1.0 * (tx.hora < 6)
    + 1.8 * (tx.diasConta < 7)
    + 0.6 * (tx.tentativas - 1)
    + 2.0 * tx.paisDiferente
    + 1.8 * tx.emailDescartavel
    + 0.7 * tx.entregaDiferente
    + 0.6 * tx.dispositivoNovo
    - 0.12 * Math.min(tx.comprasAnteriores, 10)
    + 0.8 * (tx.paisDiferente && tx.dispositivoNovo)
    + ruido;
}

export function gerarTransacoes(n, semente = 42) {
  const r = aleatorio(semente);
  const lista = [];
  for (let i = 0; i < n; i++) {
    const categoria = escolher(r, CATEGORIAS, [0.3, 0.25, 0.2, 0.17, 0.08]);
    const diasConta = Math.floor(Math.exp(r() * Math.log(2001))) - 1; // de 0 a 2000 dias, mais contas antigas
    const tx = {
      id: i + 1,
      categoria,
      valor: Math.round(Math.max(5, VALOR_BASE[categoria] * Math.exp(normal(r) * 0.7)) * 100) / 100,
      hora: r() < 0.1 ? Math.floor(r() * 6) : 6 + Math.floor(r() * 18),
      diasConta,
      comprasAnteriores: Math.floor((diasConta / 90) * r() * 3),
      tentativas: r() < 0.86 ? 1 : 2 + Math.floor(r() * 6),
      paisDiferente: r() < 0.06,
      emailDescartavel: r() < 0.05,
      entregaDiferente: r() < 0.18,
      dispositivoNovo: r() < 0.25,
    };
    tx.fraude = r() < sigmoide(riscoReal(tx, normal(r) * 0.5));
    lista.push(tx);
  }
  return lista;
}

/* ---------- O que o modelo enxerga de cada transação ---------- */
export const ATRIBUTOS = [
  { nome: "Valor da compra", vale: tx => Math.log10(tx.valor) },
  { nome: "Compra de madrugada (0h–6h)", vale: tx => (tx.hora < 6 ? 1 : 0) },
  { nome: "Conta criada há menos de 7 dias", vale: tx => (tx.diasConta < 7 ? 1 : 0) },
  { nome: "Idade da conta", vale: tx => Math.log10(tx.diasConta + 1) },
  { nome: "Tentativas com o cartão em 24h", vale: tx => tx.tentativas },
  { nome: "IP de outro país", vale: tx => +tx.paisDiferente },
  { nome: "E-mail descartável", vale: tx => +tx.emailDescartavel },
  { nome: "Entrega diferente da cobrança", vale: tx => +tx.entregaDiferente },
  { nome: "Dispositivo nunca visto", vale: tx => +tx.dispositivoNovo },
  { nome: "Compras anteriores", vale: tx => Math.log10(tx.comprasAnteriores + 1) },
  { nome: "Categoria: Eletrônicos", vale: tx => +(tx.categoria === "Eletrônicos") },
  { nome: "Categoria: Gift card", vale: tx => +(tx.categoria === "Gift card") },
  { nome: "Categoria: Serviços", vale: tx => +(tx.categoria === "Serviços") },
  { nome: "Categoria: Alimentos", vale: tx => +(tx.categoria === "Alimentos") },
];
export const vetor = tx => ATRIBUTOS.map(a => a.vale(tx));

/* ---------- Separar treino e teste ---------- */
export function separar(lista, fracaoTeste = 0.25, semente = 7) {
  const r = aleatorio(semente);
  const embaralhada = [...lista];
  for (let i = embaralhada.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [embaralhada[i], embaralhada[j]] = [embaralhada[j], embaralhada[i]];
  }
  const corte = Math.round(embaralhada.length * (1 - fracaoTeste));
  return { treino: embaralhada.slice(0, corte), teste: embaralhada.slice(corte) };
}

/* ---------- Treino: regressão logística com descida do gradiente ---------- */
// Fraude é rara (~4%), então cada fraude pesa mais no erro: senão o modelo aprende a dizer
// "nunca é fraude" e acerta 96% sem servir para nada.
export function criarTreino(lista, { taxa = 0.5, l2 = 0.001 } = {}) {
  const X = lista.map(vetor);
  const y = lista.map(tx => (tx.fraude ? 1 : 0));
  const d = ATRIBUTOS.length, n = X.length;
  const media = Array(d).fill(0), desvio = Array(d).fill(0);
  for (const x of X) x.forEach((v, j) => { media[j] += v / n; });
  for (const x of X) x.forEach((v, j) => { desvio[j] += (v - media[j]) ** 2 / n; });
  for (let j = 0; j < d; j++) desvio[j] = Math.sqrt(desvio[j]) || 1;
  const Z = X.map(x => x.map((v, j) => (v - media[j]) / desvio[j]));
  const positivos = y.reduce((s, v) => s + v, 0);
  const pesoFraude = positivos ? (n - positivos) / positivos : 1;
  const w = Array(d).fill(0);
  let b = 0, epoca = 0;

  function passo(epocas = 1) {
    let perda = 0;
    for (let e = 0; e < epocas; e++) {
      const gw = Array(d).fill(0);
      let gb = 0, soma = 0, pesoTotal = 0;
      for (let i = 0; i < n; i++) {
        let z = b;
        for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
        const p = sigmoide(z);
        const peso = y[i] ? pesoFraude : 1;
        const erro = (p - y[i]) * peso;
        for (let j = 0; j < d; j++) gw[j] += erro * Z[i][j];
        gb += erro;
        soma -= peso * (y[i] ? Math.log(p + 1e-12) : Math.log(1 - p + 1e-12));
        pesoTotal += peso;
      }
      for (let j = 0; j < d; j++) w[j] -= taxa * (gw[j] / pesoTotal + l2 * w[j]);
      b -= taxa * (gb / pesoTotal);
      perda = soma / pesoTotal;
      epoca++;
    }
    return perda;
  }

  const modelo = () => criarModelo({ w: [...w], b, media: [...media], desvio: [...desvio] });
  return { passo, modelo, get epoca() { return epoca; } };
}

export function criarModelo({ w, b, media, desvio }) {
  const padronizar = tx => vetor(tx).map((v, j) => (v - media[j]) / desvio[j]);
  return {
    w, b, media, desvio,
    prever(tx) {
      const z = padronizar(tx).reduce((s, v, j) => s + v * w[j], b);
      return sigmoide(z);
    },
    // Quanto cada atributo empurrou o risco desta transação, comparada a uma transação média.
    explicar(tx) {
      return padronizar(tx)
        .map((v, j) => ({ nome: ATRIBUTOS[j].nome, efeito: v * w[j] }))
        .sort((a, c) => Math.abs(c.efeito) - Math.abs(a.efeito));
    },
    importancia() {
      return ATRIBUTOS.map((a, j) => ({ nome: a.nome, peso: w[j] })).sort((a, c) => Math.abs(c.peso) - Math.abs(a.peso));
    },
  };
}

/* ---------- Avaliação ---------- */
export function avaliar(lista, probs, limiar = 0.5) {
  let vp = 0, fp = 0, vn = 0, fn = 0, barrado = 0, escapou = 0, bloqueouBom = 0;
  lista.forEach((tx, i) => {
    const bloqueia = probs[i] >= limiar;
    if (tx.fraude && bloqueia) { vp++; barrado += tx.valor; }
    else if (tx.fraude) { fn++; escapou += tx.valor; }
    else if (bloqueia) { fp++; bloqueouBom += tx.valor; }
    else vn++;
  });
  const div = (a, c) => (c ? a / c : 0);
  return {
    vp, fp, vn, fn,
    acuracia: div(vp + vn, lista.length),
    precisao: div(vp, vp + fp),          // dos bloqueios, quantos eram fraude mesmo
    recall: div(vp, vp + fn),            // das fraudes, quantas o modelo pegou
    falsoAlarme: div(fp, fp + vn),       // dos clientes bons, quantos foram incomodados
    barrado, escapou, bloqueouBom,
  };
}

// AUC: chance de o modelo dar mais risco a uma fraude do que a uma compra boa (1 = perfeito, 0,5 = chute).
export function auc(lista, probs) {
  const pares = lista.map((tx, i) => [probs[i], tx.fraude ? 1 : 0]).sort((a, c) => a[0] - c[0]);
  let somaRanks = 0, positivos = 0;
  for (let i = 0; i < pares.length;) {
    let j = i;
    while (j < pares.length && pares[j][0] === pares[i][0]) j++;
    const rankMedio = (i + 1 + j) / 2; // empates dividem a posição
    for (let k = i; k < j; k++) if (pares[k][1]) { somaRanks += rankMedio; positivos++; }
    i = j;
  }
  const negativos = pares.length - positivos;
  if (!positivos || !negativos) return 0.5;
  return (somaRanks - (positivos * (positivos + 1)) / 2) / (positivos * negativos);
}

export function curvaROC(lista, probs, pontos = 60) {
  const curva = [];
  for (let i = 0; i <= pontos; i++) {
    const m = avaliar(lista, probs, 1 - i / pontos);
    curva.push({ x: m.falsoAlarme, y: m.recall });
  }
  return curva;
}
