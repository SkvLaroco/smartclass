<?php
/**
 * api/summarize.php — Lesson Summarizer using LOCAL Ollama model
 *
 * Calls your locally running Ollama instance (http://localhost:11434).
 * No API key. No internet. Completely free.
 *
 * Supported input:
 *   POST { text: string, mode: 'mic'|'file'|'text' }
 *
 * Returns:
 *   { ok: true,  summary: { title, summary, keyPoints[], keyTerms[], wordCount } }
 *   { ok: false, error: string, code: string }
 */

require_once __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

// ── Input ─────────────────────────────────────────────────────────────────────
$body = json_decode(file_get_contents('php://input'), true) ?? [];
$text = trim($body['text'] ?? '');
$mode = $body['mode'] ?? 'text';

if (strlen($text) < 10) {
    jsonResponse(['ok' => false, 'error' => 'Text is too short to summarize.', 'code' => 'TOO_SHORT'], 400);
}

// ── Check Ollama is reachable first ──────────────────────────────────────────
$check = @file_get_contents(OLLAMA_HOST . '/api/tags');
if ($check === false) {
    jsonResponse([
        'ok'    => false,
        'error' => 'Ollama is not running. Open a terminal and run: ollama serve',
        'code'  => 'OLLAMA_OFFLINE'
    ], 503);
}

// Check the chosen model is actually pulled
$tagsData = json_decode($check, true);
$pulledModels = array_column($tagsData['models'] ?? [], 'name');
// Ollama names include ":latest" tag — strip it for comparison
$pulledBase = array_map(function($m) { return explode(':', $m)[0]; }, $pulledModels);
$wantedBase = explode(':', OLLAMA_MODEL)[0];

if (!in_array($wantedBase, $pulledBase, true)) {
    $available = implode(', ', $pulledBase) ?: 'none';
    jsonResponse([
        'ok'    => false,
        'error' => 'Model "' . OLLAMA_MODEL . '" is not pulled yet. Run: ollama pull ' . OLLAMA_MODEL
                 . ' | Available models: ' . $available,
        'code'  => 'MODEL_NOT_FOUND'
    ], 503);
}

// ── Build prompt ──────────────────────────────────────────────────────────────
// Truncate to ~5000 chars to keep inference fast on local hardware
$truncated = mb_substr($text, 0, 5000) . (mb_strlen($text) > 5000 ? "\n[...truncated...]" : '');

$prompt = <<<PROMPT
You are an expert classroom lesson summarizer for Filipino students.
The input may contain Tagalog, Filipino, or mixed Tagalog-English (Taglish).

Instructions:
1. Translate any Tagalog/Filipino words to English naturally.
2. Write a complete, accurate lesson summary fully in English.
3. Base the summary ONLY on the provided text — do not invent content.
4. Return ONLY a valid JSON object. No markdown, no explanation, no extra text.

Required JSON format (all fields required):
{
  "title": "Clear descriptive lesson title (5-10 words)",
  "summary": "Thorough 4-6 sentence summary covering all main concepts",
  "keyPoints": ["point 1", "point 2", "point 3", "point 4", "point 5"],
  "keyTerms": ["term1", "term2", "term3", "term4", "term5", "term6"],
  "wordCount": <integer>
}

Lesson content to summarize:
---
$truncated
---

Respond with ONLY the JSON object:
PROMPT;

// ── Call Ollama API ───────────────────────────────────────────────────────────
$payload = json_encode([
    'model'  => OLLAMA_MODEL,
    'prompt' => $prompt,
    'stream' => false,          // get full response at once
    'options' => [
        'temperature'   => 0.3, // low temp = more factual, less creative
        'num_predict'   => 800, // max tokens in response
        'top_p'         => 0.9,
        'repeat_penalty'=> 1.1,
    ]
]);

$ch = curl_init(OLLAMA_HOST . '/api/generate');
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => $payload,
    CURLOPT_TIMEOUT        => 120,        // local models can be slow on first run
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlErr  = curl_error($ch);
curl_close($ch);

if ($curlErr) {
    jsonResponse(['ok' => false, 'error' => 'Cannot reach Ollama: ' . $curlErr, 'code' => 'CURL_ERROR'], 502);
}

if ($httpCode !== 200) {
    jsonResponse(['ok' => false, 'error' => 'Ollama returned HTTP ' . $httpCode, 'code' => 'OLLAMA_ERROR'], 502);
}

$ollamaData = json_decode($response, true);
$raw = trim($ollamaData['response'] ?? '');

if (!$raw) {
    jsonResponse(['ok' => false, 'error' => 'Ollama returned an empty response.', 'code' => 'EMPTY_RESPONSE'], 502);
}

// ── Parse JSON from model output ──────────────────────────────────────────────
// Strip any accidental markdown fences the model may add despite instructions
$clean = preg_replace('/^```(?:json)?\s*/m', '', $raw);
$clean = preg_replace('/\s*```$/m', '', $clean);
$clean = trim($clean);

// Some models prepend a sentence before the JSON — extract the JSON block
if (!str_starts_with($clean, '{')) {
    preg_match('/\{[\s\S]+\}/m', $clean, $matches);
    $clean = $matches[0] ?? $clean;
}

$parsed = json_decode($clean, true);

if (!$parsed || !isset($parsed['summary'])) {
    // The model returned text instead of JSON — wrap it gracefully
    $parsed = [
        'title'     => 'Lesson Summary',
        'summary'   => strip_tags($raw),
        'keyPoints' => [],
        'keyTerms'  => [],
        'wordCount' => str_word_count($text),
    ];
}

// Ensure wordCount is accurate (use actual input word count)
$parsed['wordCount'] = str_word_count($text);

// Sanitise arrays in case model returned strings
foreach (['keyPoints', 'keyTerms'] as $field) {
    if (!isset($parsed[$field]) || !is_array($parsed[$field])) {
        $parsed[$field] = [];
    }
}

jsonResponse(['ok' => true, 'summary' => $parsed]);