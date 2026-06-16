export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        message: "Método não permitido. Use POST."
      });
    }

    const authKey = req.headers["x-heatsoak-key"];

    if (!process.env.UPDATE_SECRET || authKey !== process.env.UPDATE_SECRET) {
      return res.status(401).json({
        ok: false,
        message: "Senha de atualização inválida."
      });
    }

    const {
      csvText,
      fileName = "heat_soak.json"
    } = req.body || {};

    if (!csvText || typeof csvText !== "string") {
      return res.status(400).json({
        ok: false,
        message: "CSV não recebido."
      });
    }

    const parsedData = parseCsv(csvText);

    const payload = {
      atualizadoEm: new Date().toISOString(),
      origem: "Upload CSV pelo Dashboard Heat Soak",
      quantidadeRegistros: parsedData.length,
      dados: parsedData
    };

    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    const branch = process.env.GITHUB_BRANCH || "main";
    const path = process.env.GITHUB_FILE_PATH || fileName;
    const token = process.env.GITHUB_TOKEN;

    if (!owner || !repo || !token) {
      return res.status(500).json({
        ok: false,
        message: "Variáveis do GitHub não configuradas na Vercel."
      });
    }

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;

    let sha = null;

    const getFileResponse = await fetch(`${apiUrl}?ref=${branch}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });

    if (getFileResponse.ok) {
      const fileInfo = await getFileResponse.json();
      sha = fileInfo.sha;
    } else if (getFileResponse.status !== 404) {
      const erro = await getFileResponse.text();
      return res.status(500).json({
        ok: false,
        message: "Erro ao buscar arquivo atual no GitHub.",
        detalhe: erro
      });
    }

    const contentBase64 = Buffer
      .from(JSON.stringify(payload, null, 2), "utf8")
      .toString("base64");

    const commitBody = {
      message: `Atualiza base Heat Soak - ${new Date().toLocaleString("pt-BR")}`,
      content: contentBase64,
      branch
    };

    if (sha) {
      commitBody.sha = sha;
    }

    const updateResponse = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28"
      },
      body: JSON.stringify(commitBody)
    });

    if (!updateResponse.ok) {
      const erro = await updateResponse.text();
      return res.status(500).json({
        ok: false,
        message: "Erro ao atualizar arquivo no GitHub.",
        detalhe: erro
      });
    }

    return res.status(200).json({
      ok: true,
      message: "Base Heat Soak atualizada com sucesso no GitHub.",
      quantidadeRegistros: parsedData.length,
      arquivo: path
    });

  } catch (error) {
    return res.status(500).json({
      ok: false,
      message: "Erro interno na API.",
      detalhe: error.message
    });
  }
}

function parseCsv(csvText) {
  const cleanText = csvText.replace(/^\uFEFF/, "").trim();

  if (!cleanText) return [];

  const delimiter = detectDelimiter(cleanText);
  const rows = splitCsvRows(cleanText, delimiter);

  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeHeader);

  return rows.slice(1)
    .filter(row => row.some(cell => String(cell || "").trim() !== ""))
    .map(row => {
      const obj = {};

      headers.forEach((header, index) => {
        obj[header] = row[index] ?? "";
      });

      return obj;
    });
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/)[0] || "";

  const semicolonCount = (firstLine.match(/;/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const tabCount = (firstLine.match(/\t/g) || []).length;

  if (semicolonCount >= commaCount && semicolonCount >= tabCount) return ";";
  if (tabCount >= commaCount) return "\t";
  return ",";
}

function splitCsvRows(text, delimiter) {
  const rows = [];
  let row = [];
  let cell = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        cell += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === delimiter && !insideQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") i++;

      row.push(cell);
      rows.push(row);

      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rows.push(row);

  return rows;
}

function normalizeHeader(header) {
  return String(header || "")
    .trim()
    .replace(/\s+/g, " ");
}
