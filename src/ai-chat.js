import 'dotenv/config'
import Groq from 'groq-sdk'
import googleSheetService from './sheets.js'
import chatHistoryService from './chat-history.js'

class GroqService {
    constructor() {
        this.groq = new Groq({
            apiKey: process.env.GROQ_API_KEY,
        })
        this.settings = null
    }

    async loadSettings() {
        const settings = await googleSheetService.getPrompts()
        this.settings = settings
    }

    async getResponse(userInput, phoneNumber = null) {
        if (!this.settings) {
            await this.loadSettings()
        }

        try {
            const messages = [
                {
                    role: 'system',
                    content: `
Eres GoldenCoach, asesor de ventas de Golden Gym.

REGLAS:
- Responde máximo 3 líneas
- No inventes información
- No des rutinas personalizadas
- No des consejos médicos
- No inventes clases grupales, solo menciona Baile Fitness 💃  

FUNCIÓN:
- Responder dudas básicas de gimnasio
- Luego guiar a elegir un plan


CASOS:

Si preguntan sobre días de entrenamiento:
👉 Recomienda 3 a 4 días por semana si es principiante

Si preguntan sobre cardio:
👉 Responde de forma general (sin personalizar demasiado)

Si preguntan sobre entrenamiento:
👉 Mantén respuestas básicas y seguras

SI HAY LESIÓN:
👉 Si tienes una lesión, lo ideal es consultar a un especialista antes de entrenar.
❓ ¿Quieres ver los planes disponibles?

FORMATO:
👉 Respuesta directa  
📌 Explicación breve  
❓ Pregunta para continuar (llevar a plan)

OBJETIVO:
Convertir la duda en interés por un plan.
`
                }
            ]

            if (phoneNumber) {
                const context = await chatHistoryService.getContextForAI(phoneNumber)
                messages.push(...context)
            }

            messages.push({
                role: 'user',
                content: userInput,
            })

            const chatCompletion = await this.groq.chat.completions.create({
                messages,
                model: 'llama-3.1-8b-instant',
                temperature: 0.2,
                max_tokens: 120,
                top_p: 0.9,
            })

            let aiResponse = chatCompletion.choices[0].message?.content || ''

            aiResponse = aiResponse.trim()

            // 🔒 CONTROL MÉDICO
            if (
                userInput.toLowerCase().includes("lesion") ||
                userInput.toLowerCase().includes("dolor")
            ) {
                return "👉 Si tienes una lesión, lo ideal es consultar a un especialista antes de entrenar.\n❓ ¿Quieres ver los planes disponibles?"
            }

            // 🔁 FORZAR VENTAS
            if (!aiResponse.toLowerCase().includes("plan")) {
                aiResponse += "\n❓ Escribe *planes* para ver las opciones disponibles"
            }

            // 💾 HISTORIAL
            if (phoneNumber) {
                await chatHistoryService.saveMessage(phoneNumber, 'user', userInput)
                await chatHistoryService.saveMessage(phoneNumber, 'assistant', aiResponse)
            }

            return aiResponse

        } catch (error) {
            console.error('❌ GROQ ERROR:', error)
            return "👉 Escribe *planes* para ver las opciones disponibles."
        }
    }
}

export default new GroqService()