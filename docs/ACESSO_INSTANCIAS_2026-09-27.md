# Acesso da sua instância

O Shogun conecta os serviços pela BunnyFy. A configuração pede somente nome do bot, número do dono, número do bot e chave BunnyFy opcional. Credenciais de provedores ficam na API.

## Uso gratuito

- Conversa e escolha de modelo estão disponíveis para todas as instâncias e não consomem a franquia diária.
- Sem chave paga, cada instância recebe 20 chamadas por dia para downloads, transcrição, geração de imagens e os outros serviços com consumo.
- Upload e processamento podem ser chamadas distintas. A contagem é mantida na API e renova à meia-noite de Brasília.
- Erros internos devolvem a chamada reservada quando o registro está disponível. Reiniciar o bot não renova a franquia.
- Ao atingir o limite, o bot informa como ampliar o acesso. A conversa continua disponível.

Para API e hospedagem, [fale com a Domo pelo WhatsApp](https://wa.me/5522997028553). Instalar e rodar sua própria instância do Shogun continua sendo gratuito.

## Integração

Uma instalação mantém uma chave Ed25519 privada local, fora do Git. POST /v1/instances/trial valida a assinatura e emite uma credencial vinculada à chave pública. Repetir o vínculo preserva o uso. GET /v1/instances/usage consulta o saldo; GET /v1/conversation/models lista os modelos disponíveis.

A identificação comprova posse da chave da instalação. Ela não comprova posse de um número do WhatsApp. Há limites de registro, frequência e concorrência; o acesso gratuito não permite operações administrativas. Chaves pagas mantêm seus escopos e condições próprios.

## Instagram

O extrator suporta fotos, vídeos e carrosséis. Uma sessão do Instagram, quando necessária, é configurada pelo operador na API; os bots não precisam fazer login. O arquivo de sessão é privado e nunca deve ser incluído no Git ou no código distribuído. A presença do extrator não garante que o Instagram disponibilize todas as publicações.