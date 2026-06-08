async function test() {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer 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`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [{ 
        role: 'system', 
        content: 'You are an AI that writes prompt variations for music generation. Output ONLY a valid JSON object with a single key "variations" containing an array of 10 string prompts. Do not include markdown blocks or any other text.' 
      }, { 
        role: 'user', 
        content: `Generate 10 different detailed prompt variations based on this idea: "test"` 
      }]
    })
  });
  const text = await res.text();
  console.log(res.status, text);
}
test();
