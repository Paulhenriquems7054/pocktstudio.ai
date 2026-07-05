import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Share } from '@capacitor/share';

// --- Funções Auxiliares ---
// Nota: A funcionalidade permanece a mesma.

const toBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = error => reject(error);
});

const compressImageToBase64 = (dataUrl, maxWidth = 1024, quality = 0.8) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, maxWidth / img.width);
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error('Falha ao comprimir a imagem.'));
                return;
            }

            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        }, 'image/jpeg', quality);
    };
    img.onerror = reject;
    img.src = dataUrl;
});

const fetchWithRetry = (url, options, retries = 5, backoff = 1000) => {
    return new Promise((resolve, reject) => {
        const attempt = async (retryCount, delay) => {
            try {
                const response = await fetch(url, options);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    console.error('Erro de API:', errorData);
                    if (response.status === 429 && retryCount > 0) {
                        console.log(`Limite de taxa atingido. Tentando novamente em ${delay / 1000}s...`);
                        setTimeout(() => attempt(retryCount - 1, delay * 2), delay);
                    } else if (response.status === 401) {
                        reject(new Error(`A solicitação da API falhou com o status 401: Não autorizado. Verifique se sua chave de API é válida.`));
                    }
                    else {
                        reject(new Error(`A solicitação da API falhou com o status ${response.status}: ${errorData.error?.message || 'Erro desconhecido'}`));
                    }
                } else {
                    // Adiciona log de resposta para debug de geração de imagem
                    const jsonResponse = await response.json();
                    resolve(jsonResponse);
                }
            } catch (error) {
                if (retryCount > 0) {
                    console.log(`A solicitação falhou. Tentando novamente em ${delay / 1000}s...`, error);
                    setTimeout(() => attempt(retryCount - 1, delay * 2), delay);
                } else {
                    reject(error);
                }
            }
        };
        attempt(retries, backoff);
    });
};

const cropImage = (imageUrl, aspectRatio) => new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = imageUrl;
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        let sourceX, sourceY, sourceWidth, sourceHeight;
        const originalWidth = img.width;
        const originalHeight = img.height;
        const originalAspectRatio = originalWidth / originalHeight;

        const [targetW, targetH] = aspectRatio.split(':').map(Number);
        const targetAspectRatio = targetW / targetH;

        if (originalAspectRatio > targetAspectRatio) {
            sourceHeight = originalHeight;
            sourceWidth = originalHeight * targetAspectRatio;
            sourceX = (originalWidth - sourceWidth) / 2;
            sourceY = 0;
        } else {
            sourceWidth = originalWidth;
            sourceHeight = originalWidth / targetAspectRatio;
            sourceY = (originalHeight - sourceHeight) / 2;
            sourceX = 0;
        }

        canvas.width = sourceWidth;
        canvas.height = sourceHeight;

        ctx.drawImage(img, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);
        resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = (err) => reject(err);
});

// Implementação para generateDynamicPrompt (usado pelo tema '80s Mall)
const generateDynamicPrompt = async (themeDescription) => {
    // Em uma aplicação real, isso deveria chamar a API Gemini para definir o estilo.
    // Usaremos um fallback/placeholder aqui.
    console.log("Gerando prompt dinâmico (usando fallback) para:", themeDescription);
    // Simular atraso
    await new Promise(resolve => setTimeout(resolve, 1500));
    return "Um fundo de estúdio retrô dos anos 80 com raios laser, formas geométricas de neon, névoa e iluminação de fundo dramática.";
};


const generateImageWithRetry = async (payload, apiKey, totalAttempts = 3) => {
    let lastError;
    const endpoint = '/api/gemini';

    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
        try {
            const result = await fetchWithRetry(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'gemini-2.5-flash-image-preview',
                    payload
                })
            });
            
            const base64Data = result?.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;


            if (base64Data) {
                return `data:image/png;base64,${base64Data}`;
            }

            // Se a chamada for bem-sucedida (status 200), mas não houver dados de imagem
            lastError = new Error(`A API retornou uma resposta, mas o campo 'inlineData' estava ausente ou vazio. Possível falha de renderização interna. Resposta completa: ${JSON.stringify(result).substring(0, 500)}...`);
            console.warn(`Tentativa ${attempt}/${totalAttempts}: ${lastError.message}`);

        } catch (error) {
            lastError = error;
            console.error(`Tentativa ${attempt}/${totalAttempts} falhou:`, error);
        }

        if (attempt < totalAttempts) {
            const delay = 2500 * Math.pow(2, attempt - 1);
            console.log(`Aguardando ${delay / 1000}s antes da próxima tentativa...`);
            await new Promise(res => setTimeout(res, delay));
        }
    }

    throw new Error(`A geração da imagem falhou após ${totalAttempts} tentativas. Último erro: ${lastError?.message || 'Erro desconhecido'}`);
};

const getModelInstruction = (template, prompt, options) => {
    const {
        headshotExpression, headshotPose,
        currentAlbumStyle,
        hairColors,
        haircutImage,
        clothingImage,
        lookbookStyle, customLookbookStyle,
        mainPrompt,
        figurineBoxTitle, figurineAccessoryImage,
        cameraAngle, cameraLens, lightingStyle, compositionStyle, subjectPose, facialExpression, backgroundOption, backgroundDescription,
        uploadedImage,
        proportion,
        perspective, customAngle, perspectiveDescription
    } = options;
    
    let baseInstruction = '';

    switch (template) {
        case 'promptBased':
            if (uploadedImage) {
                baseInstruction = `A mais alta prioridade é manter as características faciais exatas e a semelhança da pessoa na foto de referência. Coloque essa pessoa na seguinte cena, descrita pelo usuário: "${prompt.base}". Adapte o cabelo, roupas e fundo para se adequarem à cena, mantendo a identidade da pessoa.`;
            } else {
                baseInstruction = `Crie uma imagem fotorrealista de alta qualidade baseada na seguinte descrição do usuário: "${prompt.base}".`;
            }
            break;
        case 'decades':
            baseInstruction = `A maior prioridade é manter exatamente as características faciais, semelhança, gênero percebido, enquadramento e composição da pessoa na foto de referência fornecida. Mantendo a composição da foto original, mude o cabelo, roupas e acessórios da pessoa, bem como o fundo da foto, para combinar com o estilo dos ${prompt.id}. Não altere a estrutura facial principal da pessoa. A consistência da identidade da pessoa é crucial.`;
            break;
        case 'ensaioNatalino':
             baseInstruction = `A maior prioridade é manter exatamente as características faciais e a semelhança da pessoa na foto de referência. Transforme a imagem em um ensaio fotográfico de Natal, aplicando o seguinte estilo e cenário: "${prompt.base}". Mude as roupas e o fundo para combinar com a cena festiva, mas não altere a estrutura facial principal da pessoa. A identidade deve ser preservada.`;
            break;
        case 'impossibleSelfies':
            baseInstruction = `A maior prioridade é manter exatamente as características faciais, semelhança e gênero percebido da pessoa na foto de referência fornecida. Mantendo a composição da foto original o máximo possível, coloque a pessoa na seguinte cena, mudando suas roupas, cabelo e o fundo para combinar: ${prompt.base}. Não altere a estrutura facial principal da pessoa.`;
            break;
        case 'cinematicPortrait':
            baseInstruction = `A maior prioridade is manter exatamente as características faciais e a semelhança da pessoa na foto de referência. Transforme a imagem em um retrato cinematográfico de estúdio, altamente detalhado e atmosférico, aplicando o seguinte estilo: "${prompt.base}". Ajuste a iluminação, a expressão e o cenário para corresponder ao estilo cinematográfico, mas não altere a estrutura facial principal da pessoa. A identidade deve ser preservada.`;
            break;
        case 'fashionEditorial':
            baseInstruction = `A maior prioridade é manter exatamente as características faciais e a semelhança da pessoa na foto de referência. Transforme a imagem em uma foto de editorial de moda de alta-costura, no estilo de uma revista como a GQ, aplicando o seguinte estilo: "${prompt.base}". Mude as roupas, a iluminação e o cenário para se adequarem ao estilo de revista, mas não altere a estrutura facial principal da pessoa.`;
            break;
        case 'streetwearDeLuxo':
        case 'urbanoFuturista':
        case 'luxoNoturno':
        case 'undergroundFuturista':
            if (uploadedImage) {
                baseInstruction = `A maior prioridade é manter exatamente as características faciais e a semelhança da pessoa na foto de referência. Transforme a imagem em uma foto de moda hiper-realista, de corpo inteiro, aplicando o seguinte estilo editorial: "${prompt.base}". Mude as roupas, o cenário e a iluminação para combinar com a descrição, mas não altere a estrutura facial ou o tipo de corpo da pessoa. A identidade deve ser preservada.`;
            } else {
                // Sem foto, limpar o prompt do tema para remover referências a "pessoa"
                let cleanPrompt = prompt.base;
                // Remover referências específicas a pessoa
                cleanPrompt = cleanPrompt.replace(/A pessoa|da pessoa|A imagem.*pessoa|Imagem.*pessoa/gi, 'A cena');
                cleanPrompt = cleanPrompt.replace(/vestindo|usa|usa calça|veste|com roupa/gi, 'com elementos de');
                cleanPrompt = cleanPrompt.replace(/caminhando|em pé|sentada|de pé/gi, 'apresentando');
                
                baseInstruction = `Aplique o seguinte estilo visual e atmosfera: ${cleanPrompt}`;
            }
            break;
        case 'spotlightPortrait':
            baseInstruction = `A maior prioridade é manter exatamente as características faciais e a semelhança da pessoa na foto de referência. Transforme a imagem em um retrato dramático em preto e branco, aplicando o seguinte estilo e cenário: "${prompt.base}". NÃO altere a estrutura facial principal da pessoa.`;
            break;
        case 'cinematicStreetStyle':
            baseInstruction = `A maior prioridade é manter exatamente as características faciais, cabelo e semelhança da pessoa na foto de referência. Recrie a foto no estilo de fotografia de rua cinematográfica, aplicando o seguinte estilo: "${prompt.base}". Mude as roupas, acessórios e cenário para combinar com a descrição, mas não altere a estrutura facial principal da pessoa.`;
            break;
        case 'shadowPortrait':
            baseInstruction = `A maior prioridade é manter exatamente as características faciais e a semelhança da pessoa na foto de referência. Coloque a pessoa em um retrato artístico, aplicando o seguinte estilo, pose e iluminação: "${prompt.base}". NÃO altere a estrutura facial principal da pessoa.`;
            break;
        case 'viceCityStyle':
            baseInstruction = `A maior prioridade é usar o rosto da foto de referência para o personagem principal. Transforme a pessoa e a cena no estilo artístico de GTA Vice City, seguindo esta descrição detalhada: "${prompt.base}". A semelhança facial é crucial.`;
            break;
        case 'urbanNeon':
            baseInstruction = `A maior prioridade é manter o rosto real da pessoa na foto de referência sem alterações. Transforme a foto em um retrato urbano cinematográfico, aplicando a seguinte pose, roupa, iluminação e estilo: "${prompt.base}". NÃO altere a estrutura facial.`;
            break;
        case 'bwProfile':
            baseInstruction = `A maior prioridade é manter o rosto real da pessoa na foto de referência sem alterações. Crie um retrato cinematográfico em preto e branco, aplicando a seguinte pose, roupa e iluminação: "${prompt.base}". NÃO altere a estrutura facial.`;
            break;
        case 'projectedSilhouette':
            baseInstruction = `A maior prioridade é manter a semelhança facial da pessoa na foto de referência. Crie um retrato de estúdio em preto e branco, aplicando a seguinte composição e iluminação para criar uma sombra de perfil distinta: "${prompt.base}". NÃO altere a estrutura facial principal.`;
            break;
        case 'popMagazineCover':
            baseInstruction = `A maior prioridade é usar a foto de referência como modelo principal. Crie uma capa de revista de alta moda seguindo esta descrição detalhada de estilo, cenário e roupa: "${prompt.base}". A semelhança facial é crucial.`;
            break;
        case 'editorialTechRetro':
        case 'mysteriousEditorial':
        case 'architectStyle':
            // Usa o prompt.base completo que contém todos os detalhes para estas fotos de estilo editorial/cinematográfico único
            baseInstruction = `A maior prioridade é manter 100% das características faciais reais e a semelhança da pessoa na foto de referência. Transforme a imagem em um retrato editorial/cinematográfico de alta qualidade aplicando exatamente esta descrição: "${prompt.base}". A fidelidade ao rosto é absoluta.`;
            break;
        case 'hairStyler': {
            if (haircutImage) {
                 baseInstruction = `A maior prioridade é manter exatamente as características faciais e a semelhança da pessoa na primeira foto de referência. Usando a segunda imagem como inspiração principal para o penteado, estilize o cabelo da pessoa na primeira foto para combinar com o corte, cor e estilo mostrados na segunda imagem. Não altere a estrutura facial principal, as roupas ou o fundo da pessoa.`;
            } else {
                let instruction = `A maior prioridade é manter exatamente as características faciais, semelhança e gênero percebido da pessoa na foto de referência fornecida. Mantendo a composição da foto original, estilize o cabelo da pessoa para ser um exemplo perfeito de ${prompt.base}. Se o cabelo da pessoa já tiver esse estilo, aprimore-o e aperfeiçoe-o. Não altere a estrutura facial principal, as roupas ou o fundo da pessoa.`;

                if (['Curto', 'Médio', 'Longo'].includes(prompt.id)) {
                    instruction += " Mantenha a textura original do cabelo da pessoa (ex: liso, ondulado, cacheado).";
                }

                if (hairColors && hairColors.length > 0) {
                    if (hairColors.length === 1) {
                        instruction += ` A cor do cabelo deve ser ${hairColors[0]}.`;
                    } else if (hairColors.length === 2) {
                        instruction += ` O cabelo deve ser uma mistura de duas cores: ${hairColors[0]} e ${hairColors[1]}.`;
                    }
                }
                baseInstruction = instruction;
            }
            break;
        }
        case 'headshots': {
            const poseInstruction = headshotPose === 'Frente' ? 'virada para a frente em direção à câmera' : 'posicionada em um leve ângulo em relação à câmera';
            baseInstruction = `A maior prioridade é manter exatamente as características faciais, semelhança e gênero percebido da pessoa na foto de referência fornecida. Transforme a imagem em uma foto de perfil profissional. A pessoa deve estar ${poseInstruction} com uma expressão de "${headshotExpression}". Ela deve estar ${prompt.base}. Por favor, mantenha o penteado original da foto. O fundo deve ser um fundo de estúdio limpo, neutro e desfocado (como cinza claro, bege ou branco). Não altere a estrutura facial principal da pessoa. A imagem final deve ser um retrato profissional bem iluminado e de alta qualidade.`;
            break;
        }
        case 'eightiesMall':
            baseInstruction = `A maior prioridade é manter exatamente as características faciais, semelhança e gênero percebido da pessoa na foto de referência fornecida. Transforme a imagem em uma foto de uma única sessão de fotos de shopping dos anos 1980. O estilo geral para toda a sessão de fotos é: "${currentAlbumStyle}". Para esta foto específica, a pessoa deve estar em ${prompt.base}. O cabelo e as roupas da pessoa devem ser no estilo dos anos 80 e ser consistentes em todas as fotos deste conjunto. O fundo e a iluminação também devem corresponder ao estilo geral de cada foto. A consistência da identidade da pessoa é crucial.`;
            break;
        case 'styleLookbook': {
             if (clothingImage) {
                baseInstruction = `A prioridade máxima é manter com exatidão absoluta as características faciais, a pose, o tipo de corpo e a semelhança da pessoa na primeira foto de referência. Usando a segunda imagem *apenas* como inspiração para a roupa, vista a pessoa na primeira foto com uma roupa que imite o estilo, corte e tecido da roupa na segunda imagem. O cenário deve ser alterado para um de alta moda adequado para ${prompt.base}. É crucial não alterar o rosto, cabelo, ou corpo da pessoa de forma alguma. Apenas a roupa e o cenário devem ser modificados.`;
            } else {
                const finalStyle = lookbookStyle === 'Outro' ? customLookbookStyle : lookbookStyle;
                baseInstruction = `A prioridade máxima é manter com exatidão absoluta as características faciais, a pose, o tipo de corpo e a semelhança da pessoa na foto de referência. Transforme a imagem em uma foto de lookbook de alta moda. O estilo da roupa deve ser "${finalStyle}". Para esta foto específica, vista a pessoa com uma roupa única e estilosa que se encaixe nesse estilo, e coloque-a em um cenário de alta moda adequado para ${prompt.base}. É crucial não alterar o rosto ou o corpo da pessoa. O cabelo e a maquiagem podem ser ajustados sutilmente para complementar o estilo. Cada foto no lookbook deve apresentar uma roupa diferente. A consistência do modelo é a principal prioridade.`;
            }
            break;
        }
        case 'figurines':
            let figurineInstruction = `A maior prioridade is manter as características faciais e a semelhança da pessoa na foto de referência. Transforme a pessoa em uma estatueta de action figure dentro de sua embalagem de varejo, como um brinquedo colecionável. A embalagem deve ser visível. O estilo geral da embalagem e da figura deve corresponder a: ${prompt.base}.`;

            if (figurineBoxTitle && figurineBoxTitle.trim() !== '') {
                figurineInstruction += ` O nome "${figurineBoxTitle}" deve estar proeminentemente exibido na embalagem.`;
            }

            if (figurineAccessoryImage) {
                figurineInstruction += ` A figura deve vir com um acessório inspirado na segunda imagem de referência fornecida.`;
            } else {
                figurineInstruction += ` A figura deve incluir um acessório temático que combine com o estilo.`;
            }

            figurineInstruction += ` A imagem final deve parecer uma fotografia de produto de um brinquedo novo em sua caixa em uma prateleira de loja. Não altere a estrutura facial principal da pessoa.`;
            baseInstruction = figurineInstruction;
            break;
        case 'personalizar':
            let personalizeInstruction = `A maior prioridade é manter exatamente as características faciais, a semelhança e as roupas da pessoa na foto de referência. NÃO mude a identidade ou as roupas da pessoa. Modifique a imagem para corresponder aos seguintes parâmetros de cena e fotografia:`;
            personalizeInstruction += `\n- Pose do Sujeito: ${subjectPose}.`;
            personalizeInstruction += `\n- Expressão Facial: ${facialExpression}.`;
            personalizeInstruction += `\n- Ângulo da Câmera: ${cameraAngle}.`;
            personalizeInstruction += `\n- Lente/Enquadramento: ${cameraLens}.`;
            personalizeInstruction += `\n- Estilo de Iluminação: ${lightingStyle}.`;
            personalizeInstruction += `\n- Composição: ${compositionStyle}.`;

            if (backgroundOption === 'mudar' && backgroundDescription.trim() !== '') {
                personalizeInstruction += `\n- Fundo: Coloque a pessoa em um novo cenário descrito como: ${backgroundDescription}.`;
            } else {
                personalizeInstruction += `\n- Fundo: Mantenha o fundo original, mas ajuste-o para combinar com a nova iluminação e estilo.`;
            }
            
            personalizeInstruction += `\nO resultado deve ser uma imagem fotorrealista consistente que pareça uma foto real.`;
            baseInstruction = personalizeInstruction;
            break;
        case 'blackAndWhite':
            baseInstruction = `A maior prioridade é manter exatamente as características faciais, semelhança, gênero percebido, enquadramento e composição da pessoa na foto de referência fornecida. Mantenha a pessoa e o fundo, mas converta toda a imagem para preto e branco, aplicando o seguinte estilo: ${prompt.base}. Não altere a estrutura facial principal ou as roupas da pessoa.`;
            break;
        case 'ghibli':
            baseInstruction = `A maior prioridade é manter exatamente a composição, pose, roupas e fundo da foto de referência original. Redesenhe a pessoa e a cena inteira no icônico estilo de arte do Studio Ghibli, prestando atenção à semelhança facial da pessoa. O sub-estilo específico para esta imagem é: ${prompt.base}. Não altere os elementos ou o cenário da foto original.`;
            break;
        case 'pixar':
             baseInstruction = `A maior prioridade é manter exatamente a composição, pose, roupas e fundo da foto de referência original. Reimagine a pessoa e a cena inteira como um personagem e cenário de um filme de animação 3D da Disney/Pixar, mantendo a semelhança facial. O sub-estilo específico para esta imagem é: ${prompt.base}. Não altere os elementos ou o cenário da foto original.`;
             break;
        case 'simpsons':
            baseInstruction = `A maior prioridade é manter exatamente a composição, pose, roupas e fundo da foto de referência original. Redesenhe a pessoa e a cena inteira no estilo de arte característico dos "Simpsons", com pele amarela e olhos grandes, mas garantindo que o rosto ainda se pareça com a pessoa na foto. O sub-estilo específico para esta imagem é: ${prompt.base}. Não altere os elementos ou o cenário da foto original.`;
            break;
        case 'figurinha':
            baseInstruction = `A prioridade máxima e absoluta é isolar o assunto principal da foto de referência e transformá-lo numa figurinha (sticker) de alta qualidade. Mantenha a aparência, características e pose do assunto com 100% de exatidão. Adicione um contorno branco e espesso e uma leve sombra projetada em volta do assunto para criar um efeito de figurinha destacada. O fundo da imagem original deve ser completamente removido. A figurinha final deve ter um fundo transparente ou branco. Além disso, aplique esta descrição do usuário ao estilo da figurinha: "${mainPrompt}".`;
            break;
        default:
            baseInstruction = `Crie uma imagem baseada na foto de referência e neste prompt: ${prompt.base}`;
            break;
    }

    let finalInstruction = baseInstruction;

    // Se o usuário digitou um prompt, ele tem PRIORIDADE sobre o tema
    if (mainPrompt && mainPrompt.trim() !== '' && template !== 'promptBased' && template !== 'figurinha') {
        // Para temas artísticos/estéticos, o prompt do usuário deve definir o CONTEÚDO, e o tema apenas o ESTILO
        const artisticThemes = ['urbanoFuturista', 'undergroundFuturista', 'luxoNoturno', 'streetwearDeLuxo', 
                                'fashionEditorial', 'cinematicPortrait', 'spotlightPortrait', 'cinematicStreetStyle',
                                'shadowPortrait', 'viceCityStyle', 'urbanNeon', 'bwProfile', 'projectedSilhouette',
                                'popMagazineCover', 'editorialTechRetro', 'mysteriousEditorial', 'architectStyle'];
        
        if (artisticThemes.includes(template)) {
            // Para temas artísticos SEM foto, o prompt do usuário é o conteúdo principal
            if (!uploadedImage) {
                finalInstruction = `Crie uma imagem fotorrealista de alta qualidade baseada na seguinte descrição do usuário: "${mainPrompt}". Aplique o seguinte estilo visual e atmosfera: ${baseInstruction}`;
            } else {
                // Com foto, adiciona o prompt do usuário como modificação
                finalInstruction = `${finalInstruction} Adicionalmente, incorpore esta descrição do usuário: "${mainPrompt}".`;
            }
        } else {
            // Para outros temas, adiciona o prompt como complemento
            finalInstruction = `${finalInstruction} Adicionalmente, siga esta instrução específica do usuário: "${mainPrompt}".`;
        }
    }
    
    // Adiciona instruções de perspectiva
    let perspectiveInstruction = '';
    switch (perspective) {
        case 'aerial':
            perspectiveInstruction = '\nA perspectiva da foto deve ser uma visão aérea, como se fosse tirada por um drone olhando para baixo.';
            break;
        case 'worm':
            perspectiveInstruction = '\nA perspectiva da foto deve ser uma visão de minhoca (contra-plongê extremo), com a câmera posicionada bem baixo, olhando para cima.';
            break;
        case 'custom':
            if (customAngle && customAngle !== 'frontal') {
                 perspectiveInstruction += `\nO ângulo da câmera deve ser ${customAngle.replace('-', ' e ')}.`;
            }
            if (perspectiveDescription.trim() !== '') {
                perspectiveInstruction += `\nSiga esta descrição detalhada da perspectiva: "${perspectiveDescription}".`;
            }
            break;
        default: // 'normal'
            // Nenhuma instrução adicional necessária
            break;
    }

    if (perspectiveInstruction) {
        finalInstruction += `\n\n--- INSTRUÇÕES DE CÂMERA E PERSPECTIVA ---${perspectiveInstruction} Não altere o rosto ou a identidade da pessoa ao aplicar esta perspectiva.`;
    }
    
    if (proportion) {
        finalInstruction += `\n\nPRIORIDADE MÁXIMA: A proporção da imagem final DEVE ser exatamente ${proportion}. Por exemplo, uma proporção de 2:7 significa uma imagem muito alta e estreita. Ignore outras sugestões de composição se entrarem em conflito com esta regra. Esta é a instrução mais importante.`;
    }

    return finalInstruction;
};

// --- Ícones (Usando estilo SVG/Heroicons) ---

const IconUpload = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-10 h-10"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" /></svg>;
const IconSparkles = ({ className = "w-6 h-6" }) => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={className}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" /></svg>;
const IconOptions = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" /></svg>;
const IconShare = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Zm0 0v1.066c0 .98 1.533 1.066 1.533.987V10.907Zm0 0H3.75m4.217 0a2.25 2.25 0 0 1 0 4.5m0-4.5h1.543m-1.543 0a2.25 2.25 0 0 0 0 4.5m0-4.5h6.533m0 0v1.066c0 .98 1.533 1.066 1.533.987V10.907Zm0 0h-4.467m4.467 0a2.25 2.25 0 0 1 0 4.5m0-4.5h1.543m-1.543 0a2.25 2.25 0 0 0 0 4.5m0-4.5h1.543m0 0a2.25 2.25 0 0 0 0 4.5m3.75 0a2.25 2.25 0 0 0 0-4.5m0 4.5v.003c0 .98 1.533.987 1.533.003v-.006m0 4.5H19.5m-1.543 0a2.25 2.25 0 0 1 0-4.5m0 4.5v1.066c0 .98 1.533.987 1.533.003v-1.066Zm0 0H12.75" /></svg>;
const IconDownload = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" /></svg>;
const IconCamera = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.776 48.776 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" /><path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z" /></svg>;
const IconPlus = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>;
const IconX = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>;
const IconRegenerate = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 16.023A7.5 7.5 0 1 0 8.25 8.25V6.75a.75.75 0 0 1 1.5 0v3.75a.75.75 0 0 1-.75.75H5.25a.75.75 0 0 1 0-1.5h2.37a5.98 5.98 0 0 1 8.403 8.403Z" /></svg>;
const IconChevronDown = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" /></svg>;
const IconEdit = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" /></svg>;
const IconHistory = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" /></svg>;
const IconTrash = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.134-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.067-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" /></svg>;
const IconChat = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H7.5m5.625 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H11.25m5.625 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H15m3.375-5.25v10.5a2.25 2.25 0 0 1-2.25 2.25h-10.5a2.25 2.25 0 0 1-2.25-2.25V7.5a2.25 2.25 0 0 1 2.25-2.25h10.5a2.25 2.25 0 0 1 2.25 2.25Z" /></svg>;
const IconSend = () => <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 18.750A.75.75 0 0 0 4.024 19.5h15.952a.75.75 0 0 0 .755-1.077l-2.673-5.228a1.5 1.5 0 0 0-1.353-1.015h-.645a.75.75 0 0 0 0 1.5h.645a.75.75 0 0 1 .677.452l2.673 5.228a.75.75 0 0 1-.677 1.077H4.024a.75.75 0 0 1-.755-1.077L6 12Z" /></svg>;
const IconCopy = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>;
const IconCheck = () => <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>;


const AngleIcon = ({ angle }) => {
    const rotations = {
        'de cima-esquerda': 'rotate-[-135deg]', 'de cima': 'rotate-[-90deg]', 'de cima-direita': 'rotate-[-45deg]',
        'da esquerda': 'rotate-180', 'frontal': '', 'da direita': 'rotate-0',
        'de baixo-esquerda': 'rotate-135', 'de baixo': 'rotate-90', 'de baixo-direita': 'rotate-45'
    };
    if (angle === 'frontal') {
        return <div className="w-2.5 h-2.5 bg-current rounded-full"></div>;
    }
    return (
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor" className={`w-5 h-5 transition-transform ${rotations[angle]}`}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
        </svg>
    );
};


// --- Componentes React (Redesenhados) ---

// UI: Componente de Botão Modernizado
const Button = ({ children, onClick, disabled, primary = false, className = '' }) => {
    const baseClass = "px-6 py-2 rounded-md font-semibold tracking-wider uppercase transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed";
    const themeClass = primary 
        ? "bg-yellow-400 text-black hover:bg-yellow-300" 
        : "bg-transparent border border-gray-600 text-gray-300 hover:bg-gray-800 hover:text-white";
    
    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`${baseClass} ${themeClass} ${className}`}
        >
            {children}
        </button>
    );
};

// UI: PhotoDisplay Modernizado
const PhotoDisplay = ({ era, imageUrl, onDownload, onRegenerate, onEdit, onDelete, onShare, onSave, isPolaroid = true, index=0, showLabel = true }) => {
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const menuRef = useRef(null);

    // Fecha o menu ao clicar fora
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (menuRef.current && !menuRef.current.contains(event.target)) {
                setIsMenuOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);
    
    const handleDownloadClick = async (ratio) => {
        setIsDownloading(true);
        try {
            await onDownload(imageUrl, era, ratio);
        } finally {
            setIsDownloading(false);
            setIsMenuOpen(false);
        }
    };

    const rotation = useMemo(() => {
        if (!isPolaroid) return 'rotate-0';
        const rotations = ['rotate-1', '-rotate-1', 'rotate-0.5', '-rotate-1.5'];
        return rotations[index % rotations.length];
    }, [index, isPolaroid]);

    const containerClass = isPolaroid
            ? `relative group bg-gray-100 p-3 pb-12 shadow-xl transform transition-all duration-300 hover:shadow-2xl hover:scale-105 ${rotation}`
            : 'relative group pb-4 bg-gray-900 rounded-xl shadow-lg transition-all duration-300 hover:shadow-2xl hover:scale-105';
    
    const imageContainerClass = isPolaroid
            ? 'aspect-square bg-gray-200'
            : 'rounded-t-xl overflow-hidden';

    const textClass = isPolaroid
        ? 'text-center mt-4 font-caveat text-3xl text-gray-900 absolute bottom-3 left-0 right-0'
        : 'text-center mt-3 text-lg font-semibold text-gray-300 px-3';

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.5 }}
            className={containerClass}
        >
            <div className={imageContainerClass}>
                <img src={imageUrl} alt={`Você em ${era}`} className={`w-full ${isPolaroid ? 'h-full object-cover' : 'h-auto'}`} />
            </div>
            {showLabel && <p className={textClass}>{era}</p>}

            <div className="absolute top-3 right-3 z-10" ref={menuRef}>
                <button
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    className="p-2 rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors backdrop-blur-sm shadow-lg"
                    aria-label="Opções"
                >
                    <IconOptions />
                </button>

                <AnimatePresence>
                {isMenuOpen && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        transition={{ duration: 0.1 }}
                        className="absolute right-0 top-12 mt-2 w-48 origin-top-right bg-black/80 backdrop-blur-md rounded-lg shadow-2xl ring-1 ring-white/10 text-white text-sm flex flex-col p-1"
                    >
                        <span className="w-full text-left px-3 pt-2 pb-1 text-xs text-gray-500 uppercase tracking-wider">Ações</span>
                        <button onClick={() => { onShare(); setIsMenuOpen(false); }} className="w-full text-left px-3 py-2 hover:bg-yellow-400/20 rounded-md transition-colors">Partilhar</button>
                        <button onClick={() => { onEdit(); setIsMenuOpen(false); }} className="w-full text-left px-3 py-2 hover:bg-yellow-400/20 rounded-md transition-colors">Editar</button>
                        <button onClick={() => { onRegenerate(); setIsMenuOpen(false); }} className="w-full text-left px-3 py-2 hover:bg-yellow-400/20 rounded-md transition-colors">Gerar Novamente</button>
                        {onSave && <button onClick={() => { onSave(); setIsMenuOpen(false); }} className="w-full text-left px-3 py-2 hover:bg-green-400/20 rounded-md transition-colors text-green-400">💾 Salvar no Histórico</button>}
                        <button onClick={() => { onDelete(); setIsMenuOpen(false); }} className="w-full text-left px-3 py-2 text-red-400 hover:bg-red-500/20 rounded-md transition-colors">Apagar</button>
                        
                        <div className="my-1 h-px bg-white/10"></div>
                        
                        <span className="w-full text-left px-3 pt-1 pb-1 text-xs text-gray-500 uppercase tracking-wider">Baixar</span>
                        <button 
                            onClick={() => handleDownloadClick('1:1')} 
                            disabled={isDownloading}
                            className="w-full text-left px-3 py-2 hover:bg-yellow-400/20 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isDownloading ? '⏳ Baixando...' : 'Quadrado (1:1)'}
                        </button>
                        <button 
                            onClick={() => handleDownloadClick('9:16')} 
                            disabled={isDownloading}
                            className="w-full text-left px-3 py-2 hover:bg-yellow-400/20 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isDownloading ? '⏳ Baixando...' : 'Retrato (9:16)'}
                        </button>
                        <button 
                            onClick={() => handleDownloadClick('16:9')} 
                            disabled={isDownloading}
                            className="w-full text-left px-3 py-2 hover:bg-yellow-400/20 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isDownloading ? '⏳ Baixando...' : 'Horizontal (16:9)'}
                        </button>
                        <button 
                            onClick={() => handleDownloadClick('2:7')} 
                            disabled={isDownloading}
                            className="w-full text-left px-3 py-2 hover:bg-yellow-400/20 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isDownloading ? '⏳ Baixando...' : 'Marcador de Página (2:7)'}
                        </button>
                    </motion.div>
                )}
                </AnimatePresence>
            </div>
        </motion.div>
    );
};

// UI: Skeleton Loader para LoadingCard
const SkeletonLoader = ({ className }) => (
    <div className={`animate-pulse bg-gray-800 ${className}`}></div>
);

const LoadingCard = ({ era, isPolaroid = true, showLabel = true }) => {
    const containerClass = isPolaroid
        ? 'relative bg-gray-100 p-3 pb-12 shadow-md'
        : 'pb-4 bg-gray-900 rounded-xl shadow-md';

    const loaderClass = isPolaroid
        ? 'aspect-square'
        : 'aspect-[3/4] rounded-t-xl';
    
    return (
        <div className={containerClass}>
            <SkeletonLoader className={loaderClass} />
            
            {isPolaroid && showLabel && (
                <div className="absolute bottom-3 left-0 right-0 flex justify-center">
                     <SkeletonLoader className="h-6 w-3/4 rounded-md bg-gray-300" />
                </div>
            )}
            {!isPolaroid && showLabel && (
                 <div className="mt-3 flex justify-center">
                    <SkeletonLoader className="h-5 w-1/2 rounded-md" />
                </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center">
                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-yellow-400"></div>
            </div>
        </div>
    );
};

// UI: ErrorCard Modernizado
const ErrorCard = ({ era, isPolaroid = true, onRegenerate, showLabel = true }) => {
     const containerClass = isPolaroid
        ? 'relative group bg-gray-100 p-3 pb-12 shadow-md'
        : 'pb-4 bg-gray-900 rounded-xl shadow-md';

    const errorContainerClass = isPolaroid
        ? 'aspect-square bg-gray-200 border-2 border-dashed border-red-500/50'
        : 'rounded-t-xl bg-gray-800 border-2 border-dashed border-red-500/50 aspect-[3/4]';
    
    const textClass = isPolaroid
        ? 'text-center mt-4 font-caveat text-3xl text-gray-900 absolute bottom-3 left-0 right-0'
        : 'text-center mt-3 text-lg font-semibold text-gray-300 px-3';

    return (
        <div
            className={`relative transition-all duration-500 ease-in-out group ${containerClass} `}
        >
            <div 
                className={`flex flex-col items-center justify-center text-center p-4 ${errorContainerClass}`}
            >
                <p className="text-red-400 font-medium mb-4">A geração falhou</p>
                {onRegenerate && (
                    <Button onClick={onRegenerate} primary>
                        Tentar Novamente
                    </Button>
                )}
            </div>
            {showLabel && <p className={textClass}>{era}</p>}
        </div>
    );
};

const ErrorNotification = ({ message, onDismiss }) => {
    if (!message) return null;
    return (
        <div className="fixed top-5 left-1/2 z-50 w-full max-w-md p-4 bg-gray-900 border border-gray-700 text-gray-300 rounded-lg shadow-2xl flex items-center justify-between animate-fade-in-down" style={{ transform: 'translateX(-50%)' }}>
            <span>{message}</span>
            <button onClick={onDismiss} className="p-1 rounded-full hover:bg-gray-800 transition-colors ml-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
        </div>
    );
};

const CameraModal = ({ isOpen, onClose, onCapture }) => {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const streamRef = useRef(null);
    const [capturedImage, setCapturedImage] = useState(null);
    const [cameraError, setCameraError] = useState(null);
    const [isNative, setIsNative] = useState(false);

    useEffect(() => {
        setIsNative(Capacitor.isNativePlatform());
    }, []);

    const stopCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
        if (videoRef.current) {
            videoRef.current.srcObject = null;
        }
    }, []);

    // Função para tirar foto usando o plugin Camera do Capacitor (Android/iOS)
    const takeNativePhoto = useCallback(async () => {
        try {
            console.log("=== ABRINDO CÂMERA NATIVA ===");
            
            // Verificar e solicitar permissões
            const permissions = await Camera.checkPermissions();
            console.log("Permissões da câmera:", permissions);
            
            if (permissions.camera !== 'granted' || permissions.photos !== 'granted') {
                console.log("Solicitando permissões da câmera...");
                const requestResult = await Camera.requestPermissions({ permissions: ['camera', 'photos'] });
                console.log("Resultado da solicitação:", requestResult);
                
                if (requestResult.camera !== 'granted') {
                    setCameraError('⚠️ Permissão da câmera negada!\n\nPara usar a câmera, você precisa permitir o acesso nas configurações do app.');
                    return;
                }
            }
            
            console.log("✓ Permissões OK - Abrindo câmera...");
            
            const image = await Camera.getPhoto({
                quality: 90,
                allowEditing: false,
                resultType: CameraResultType.DataUrl,
                source: CameraSource.Camera,
                width: 1024,
                height: 1024,
                correctOrientation: true
            });
            
            console.log("✅ Foto capturada com sucesso!");
            
            // Usar a imagem diretamente
            if (image.dataUrl) {
                onCapture(image.dataUrl);
                onClose();
            }
            
        } catch (error) {
            console.error("❌ Erro ao abrir câmera nativa:", error);
            if (error.message && error.message.includes('cancelled')) {
                console.log("Usuário cancelou - fechando modal");
                // Fechar o modal quando o usuário cancelar
                onClose();
            } else {
                console.error("Erro na câmera:", error);
                setCameraError(`Erro ao acessar a câmera: ${error.message}`);
            }
        }
    }, [onCapture, onClose]);

    const startCamera = useCallback(async () => {
        if (videoRef.current) {
            setCameraError(null);
            try {
                // Para o stream anterior por precaução
                stopCamera();
                const stream = await navigator.mediaDevices.getUserMedia({
                    video: { width: { ideal: 1024 }, height: { ideal: 1024 }, facingMode: 'user' }
                });
                videoRef.current.srcObject = stream;
                streamRef.current = stream;
            } catch (err) {
                console.error("Erro ao acessar a câmera:", err);
                setCameraError("Acesso à câmera negado. Por favor, permita o acesso à câmera nas configurações do seu navegador e tente novamente. Clique no ícone de câmera na página inicial para testar o acesso.");
            }
        }
    }, [stopCamera]);

    useEffect(() => {
        console.log("CameraModal useEffect - isOpen:", isOpen, "isNative:", isNative);
        
        if (isOpen) {
            if (isNative) {
                // No modo nativo, abrir a câmera diretamente
                console.log(">>> Modo nativo detectado - abrindo câmera do dispositivo");
                // Pequeno delay para garantir que o modal está pronto
                const timer = setTimeout(() => {
                    takeNativePhoto();
                }, 100);
                return () => clearTimeout(timer);
            } else if (!capturedImage) {
                // No navegador, iniciar o stream de vídeo
                console.log("Modo web - iniciando stream de vídeo");
                startCamera();
            } else {
                stopCamera();
            }
        } else {
            console.log("Modal fechado - limpando estado");
            stopCamera();
            setCameraError(null);
        }

        // Limpeza na desmontagem
        return () => {
            stopCamera();
        };
    }, [isOpen, isNative, capturedImage, startCamera, stopCamera, takeNativePhoto]);


    const handleCapture = () => {
        if (videoRef.current && canvasRef.current) {
            const video = videoRef.current;
            const canvas = canvasRef.current;
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const context = canvas.getContext('2d');
            context.scale(-1, 1); // Inverte horizontalmente para a visualização de selfie
            context.drawImage(video, -canvas.width, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/png');
            setCapturedImage(dataUrl);
        }
    };

    const handleConfirm = () => {
        if (capturedImage) {
            onCapture(capturedImage);
            onClose();
        }
    };

    const handleRetake = () => {
        if (isNative) {
            takeNativePhoto();
        } else {
            setCapturedImage(null); // Isso fará com que o useEffect reinicie a câmera
        }
    };

    if (!isOpen) return null;

    // No modo nativo (Android/iOS), a câmera é aberta diretamente pelo sistema
    // Então não precisamos renderizar o modal completo
    if (isNative) {
        return cameraError ? (
            <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
                <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.2 }}
                    className="bg-gray-900 rounded-2xl p-6 border border-gray-700 shadow-2xl w-full max-w-md text-center relative"
                >
                    <h3 className="text-2xl font-semibold mb-4 text-white">Erro de Câmera</h3>
                    <div className="p-4 text-red-400 mb-4 whitespace-pre-line">{cameraError}</div>
                    <Button onClick={onClose}>Fechar</Button>
                </motion.div>
            </div>
        ) : null;
    }

    return (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
             <motion.div 
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2 }}
                className="bg-gray-900 rounded-2xl p-6 border border-gray-700 shadow-2xl w-full max-w-2xl text-center relative"
             >
                <h3 className="text-2xl font-semibold mb-4 text-white">Câmera</h3>
                <div className="aspect-square bg-black rounded-lg overflow-hidden relative mb-4 flex items-center justify-center">
                    {cameraError ? (
                        <div className="p-4 text-red-400">{cameraError}</div>
                    ) : (
                        <>
                            {capturedImage ? (
                                <img src={capturedImage} alt="Prévia da captura" className="w-full h-full object-cover" />
                            ) : (
                                <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover transform -scale-x-100"></video>
                            )}
                        </>
                    )}
                </div>

                <div className="flex justify-center gap-4">
                    {capturedImage ? (
                        <>
                            <Button onClick={handleRetake}>Tirar Novamente</Button>
                            <Button onClick={handleConfirm} primary>Usar Foto</Button>
                        </>
                    ) : (
                         <button onClick={handleCapture} disabled={!!cameraError} className="w-20 h-20 rounded-full bg-white border-4 border-gray-600 focus:outline-none focus:ring-4 focus:ring-yellow-400 transition-all hover:border-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed"></button>
                    )}
                </div>
                
                <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-gray-800/70 text-white hover:bg-gray-700 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
                </button>
                <canvas ref={canvasRef} className="hidden"></canvas>
            </motion.div>
        </div>
    );
};

// Componente: Edit Modal
const EditModal = ({ image, onClose, onApplyEdit, onEnhancePrompt }) => {
    const [editPrompt, setEditPrompt] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [isEnhancing, setIsEnhancing] = useState(false);

    useEffect(() => {
        if (image) {
            setEditPrompt('');
        }
    }, [image]);

    if (!image) return null;

    const handleApply = async () => {
        if (!editPrompt.trim()) return;
        setIsEditing(true);
        await onApplyEdit(image.index, editPrompt);
        setIsEditing(false);
    };

    const handleEnhance = async () => {
        if(!editPrompt.trim() || isEnhancing) return;
        setIsEnhancing(true);
        const enhanced = await onEnhancePrompt(editPrompt);
        if(enhanced) setEditPrompt(enhanced);
        setIsEnhancing(false);
    }

    return (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2 }}
                className="bg-gray-900 rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-gray-700 shadow-2xl w-full max-w-4xl text-left relative max-h-[90vh] overflow-y-auto"
            >
                <div className="flex flex-col md:flex-row gap-8">
                    <div className="md:w-1/2">
                        <h3 className="text-2xl font-semibold mb-4 text-white">Editar Imagem</h3>
                        <div className="aspect-square bg-black rounded-lg overflow-hidden relative mb-4">
                            <img src={image.imageUrl} alt={`Editando ${image.id}`} className="w-full h-full object-contain" />
                        </div>
                    </div>
                    <div className="md:w-1/2 flex flex-col">
                        <h4 className="text-lg font-semibold text-gray-300">Descreva sua edição</h4>
                        <p className="text-sm text-gray-500 mb-4">Ex: adicione um chapéu de pirata, mude o fundo para uma praia, faça em estilo aquarela.</p>
                        <div className="relative flex-grow flex flex-col">
                           <textarea
                                value={editPrompt}
                                onChange={(e) => setEditPrompt(e.target.value)}
                                placeholder="Sua descrição aqui..."
                                className="w-full bg-gray-800 border border-gray-700 rounded-lg py-3 px-4 focus:outline-none focus:ring-2 focus:ring-yellow-400 text-white transition-colors h-40 resize-none flex-grow pr-12"
                                disabled={isEditing}
                            />
                            <button 
                                onClick={handleEnhance} 
                                disabled={isEnhancing || !editPrompt}
                                className="absolute bottom-3 right-3 p-2 rounded-full bg-yellow-400/20 text-yellow-300 hover:bg-yellow-400/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                title="Melhorar Descrição com IA"
                            >
                                {isEnhancing ? (
                                     <div className="w-5 h-5 animate-spin rounded-full border-2 border-yellow-300 border-t-transparent"></div>
                                ) : (
                                     <IconSparkles className="w-5 h-5"/>
                                )}
                            </button>
                        </div>
                        <div className="flex justify-end gap-4 mt-6">
                            <Button onClick={onClose} disabled={isEditing}>Cancelar</Button>
                            <Button
                                onClick={handleApply}
                                primary
                                disabled={isEditing || !editPrompt.trim()}
                            >
                                {isEditing ? (
                                    <div className="flex items-center gap-2">
                                        <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-black"></div>
                                        <span>Aplicando...</span>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <IconEdit />
                                        <span>Aplicar Edição</span>
                                    </div>
                                )}
                            </Button>
                        </div>
                    </div>
                </div>
                <button onClick={onClose} className="absolute top-4 right-4 p-2 rounded-full bg-gray-800/70 text-white hover:bg-gray-700 transition-colors" disabled={isEditing}>
                    <IconX />
                </button>
            </motion.div>
        </div>
    );
};

// Componente para exibir o prompt de imagem final
const PromptBox = ({ prompt, onCopy }) => {
    const [copied, setCopied] = useState(false);
    
    const handleCopy = () => {
        onCopy(prompt);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="bg-yellow-900/40 border border-yellow-400 text-gray-100 rounded-xl p-4 mt-4 relative">
            <p className="font-mono text-sm whitespace-pre-wrap">{prompt}</p>
             <button
                onClick={handleCopy}
                className="absolute top-2 right-2 p-1 rounded-full bg-yellow-400/40 text-black hover:bg-yellow-400 transition-all"
                title="Copiar Prompt"
            >
                {copied ? <IconCheck className="w-4 h-4" /> : <IconCopy className="w-4 h-4" />}
            </button>
        </div>
    );
}

// Componente: Chat Modal para Geração de Prompts
const ChatModal = ({ isOpen, onClose, chatHistory, chatInput, setChatInput, isLoading, onSend }) => {
    const chatEndRef = useRef(null);
    const [copiedIndex, setCopiedIndex] = useState(null);

    const scrollToBottom = () => {
        chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(scrollToBottom, [chatHistory]);
    
    const handleCopy = (text, index) => {
        const textArea = document.createElement("textarea");
        // Remove a introdução se houver, garantindo que apenas o prompt seja copiado
        const textToCopy = text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;

        textArea.value = textToCopy;
        textArea.style.position = "fixed";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
            setCopiedIndex(index);
            setTimeout(() => setCopiedIndex(null), 2000);
        } catch (err) {
            console.error('Falha ao copiar texto: ', err);
        }
        document.body.removeChild(textArea);
    };

    if (!isOpen) return null;

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey && chatInput.trim() && !isLoading) {
            e.preventDefault();
            onSend();
        }
    };
    
    // Expressão regular para identificar se a resposta é um prompt final
    const isFinalPrompt = (text) => {
        // Verifica se o texto é um bloco grande e estruturado, o que geralmente é o prompt final
        // Ex: Começa com aspas, contém quebras de linha e palavras-chave
        return text.length > 100 && /estilo|iluminação|fotorrealista|cinematográfico/i.test(text);
    };
    
    const extractPromptText = (text) => {
        // Remove qualquer introdução antes do prompt, se a IA tiver incluído acidentalmente
        if (text.toLowerCase().includes("aqui está o prompt") || text.toLowerCase().includes("aqui está abaixo o prompt")) {
             return text.split(/aqui está o prompt|aqui está abaixo o prompt/i).pop().trim();
        }
        return text;
    };


    return (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
             <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2 }}
                className="bg-gray-900 rounded-xl sm:rounded-2xl p-4 sm:p-6 border-2 border-yellow-400 shadow-2xl w-full max-w-lg h-[90vh] flex flex-col relative"
             >
                <header className="pb-4 mb-4 border-b border-gray-700 flex justify-between items-center">
                    <h3 className="text-2xl font-semibold text-white flex items-center gap-3">
                        <IconChat />
                        Assistente de Prompts AI
                    </h3>
                    <button onClick={onClose} className="p-2 rounded-full text-gray-400 hover:bg-gray-700 hover:text-white transition-colors">
                        <IconX />
                    </button>
                </header>

                {/* Área de Mensagens */}
                <div className="flex-grow overflow-y-auto styled-scrollbar space-y-4 pr-2">
                    {chatHistory.map((msg, index) => {
                        const isModel = msg.role === 'model';
                        const isPrompt = isModel && isFinalPrompt(msg.text);
                        const textContent = isPrompt ? extractPromptText(msg.text) : msg.text;
                        
                        return (
                            <div 
                                key={index} 
                                className={`flex ${isModel ? 'justify-start' : 'justify-end'}`}
                            >
                                <div className={`max-w-xs md:max-w-md shadow-lg relative group ${
                                    !isPrompt 
                                        ? `px-4 py-3 rounded-xl ${isModel ? 'bg-gray-800 text-gray-200 rounded-tl-none' : 'bg-yellow-400 text-black rounded-br-none'}`
                                        : 'w-full' // Expande para ocupar mais espaço quando é um PromptBox
                                }`}>
                                    
                                    {!isPrompt ? (
                                        <>
                                            <p className="font-medium pr-6">{textContent}</p>
                                            <button
                                                onClick={() => handleCopy(textContent, index)}
                                                className={`absolute top-2 right-2 p-1 rounded-full ${isModel ? 'bg-yellow-400/20 text-yellow-300' : 'bg-black/10 text-black/60'} opacity-0 group-hover:opacity-100 hover:bg-yellow-400/40 transition-all`}
                                                title="Copiar"
                                            >
                                                {copiedIndex === index ? <IconCheck /> : <IconCopy />}
                                            </button>
                                        </>
                                    ) : (
                                        <PromptBox 
                                            prompt={textContent} 
                                            onCopy={(text) => handleCopy(text, index)}
                                        />
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    {isLoading && (
                         <div className="flex justify-start">
                            <div className="max-w-xs md:max-w-md px-4 py-3 rounded-xl bg-gray-800 text-gray-200 rounded-tl-none">
                                <div className="flex items-center space-x-1">
                                    <div className="h-2 w-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                                    <div className="h-2 w-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                                    <div className="h-2 w-2 bg-yellow-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={chatEndRef} />
                </div>

                {/* Área de Input */}
                <div className="pt-4 border-t border-gray-700 mt-4">
                    <div className="flex space-x-3">
                        <textarea
                            value={chatInput}
                            onChange={(e) => setChatInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Sua ideia ou pergunta..."
                            className="flex-grow resize-none bg-gray-800 border border-gray-700 rounded-xl py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-yellow-400 transition-colors h-16"
                            disabled={isLoading}
                        />
                        <button
                            onClick={onSend}
                            disabled={isLoading || !chatInput.trim()}
                            className="flex-shrink-0 w-16 h-16 rounded-xl bg-yellow-400 text-black flex items-center justify-center hover:bg-yellow-300 transition-colors disabled:opacity-50"
                        >
                            <IconSend />
                        </button>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

// UI: RadioPill Modernizado
const RadioPill = ({ name, value, label, checked, onChange }) => (
    <label className={`cursor-pointer px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm rounded-full transition-colors font-semibold 
        ${checked ? 'bg-yellow-400 text-black' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}>
        <input
            type="radio"
            name={name}
            value={value}
            checked={checked}
            onChange={onChange}
            className="hidden"
        />
        {label}
    </label>
);

// UX/UI: Cartão Seletor de Tema Visual
const TemplateCard = ({ id, name, icon, description, isSelected, onSelect, numImages, onNumImagesChange }) => {
    const singleImageThemes = ['personalizar', 'figurinha', 'spotlightPortrait', 'cinematicStreetStyle', 'shadowPortrait', 'viceCityStyle', 'urbanNeon', 'bwProfile', 'projectedSilhouette', 'popMagazineCover', 'editorialTechRetro', 'mysteriousEditorial', 'architectStyle'];
    
    return (
        <div
            onClick={() => onSelect(id)}
            className={`cursor-pointer p-3 sm:p-4 md:p-5 rounded-xl border-2 transition-all duration-300 transform hover:scale-105 active:scale-95 shadow-lg flex flex-col
            ${isSelected ? 'border-yellow-400 bg-yellow-900/20 ring-1 ring-yellow-400' : 'border-gray-700 bg-gray-900 hover:border-gray-600'}`}
        >
            <div className="flex-grow">
                <div className="text-2xl sm:text-3xl mb-2 sm:mb-3">{icon}</div>
                <h3 className="text-base sm:text-lg font-semibold text-white leading-tight">{name}</h3>
                <p className="text-xs sm:text-sm text-gray-400 mt-1 leading-snug">{description}</p>
            </div>
            <AnimatePresence>
                {isSelected && !singleImageThemes.includes(id) && (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto', marginTop: '1rem' }}
                        exit={{ opacity: 0, height: 0, marginTop: '0rem' }}
                        className="overflow-hidden"
                        onClick={(e) => e.stopPropagation()} 
                    >
                        <div className="flex justify-around items-center pt-2 border-t border-gray-700/50">
                            {[1, 2, 3, 4].map(num => (
                                <button
                                    key={num}
                                    onClick={() => onNumImagesChange(num)}
                                    className={`w-9 h-9 rounded-full font-bold transition-colors text-sm flex items-center justify-center
                                        ${numImages === num ? 'bg-yellow-400 text-black' : 'bg-gray-800 text-gray-300 hover:bg-gray-700'}`
                                    }
                                >
                                    {num}
                                </button>
                            ))}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

// UI: Componente de Upload de Imagem de Referência
const ReferenceImageUploader = ({ title, onImageUpload, uploadedImage, onRemoveImage, isLoading }) => {
    const inputRef = useRef(null);

    const handleFileChange = (event) => {
        const file = event.target.files[0];
        if (file) {
            onImageUpload(file);
        }
    };

    return (
        <div>
            <h4 className="text-lg font-semibold text-white mb-3">{title}</h4>
            <input type="file" ref={inputRef} onChange={handleFileChange} accept="image/png, image/jpeg" className="hidden" />
            {isLoading ? (
                <div className="w-full h-24 flex items-center justify-center bg-gray-800 rounded-lg">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-yellow-400"></div>
                </div>
            ) : uploadedImage ? (
                <div className="relative group">
                    <img src={`data:image/png;base64,${uploadedImage}`} alt="Prévia da referência" className="w-full h-auto max-h-40 object-contain rounded-lg bg-gray-800" />
                    <button
                        onClick={onRemoveImage}
                        className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 text-white hover:bg-black/80 transition-all opacity-0 group-hover:opacity-100"
                        aria-label="Remover imagem"
                    >
                        <IconX />
                    </button>
                </div>
            ) : (
                <button
                    onClick={() => inputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 h-24 rounded-lg border-2 border-dashed border-gray-600 hover:border-yellow-400 text-gray-400 hover:text-yellow-400 transition-colors bg-gray-700/30"
                >
                    <IconUpload />
                    <span>Enviar Imagem</span>
                </button>
            )}
        </div>
    );
};

const HistoryPanel = ({ isOpen, onClose, history, onClearHistory, onEdit, onDelete, onDownload }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/60 z-40"
          />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="fixed top-0 right-0 h-full w-full sm:w-96 md:max-w-md bg-gray-900 border-l border-gray-700 shadow-2xl z-50 flex flex-col"
          >
            <header className="flex items-center justify-between p-4 border-b border-gray-700">
              <h3 className="text-xl font-semibold text-white flex items-center gap-2">
                <IconHistory />
                <span>Histórico de Imagens</span>
              </h3>
              <button onClick={onClose} className="p-2 rounded-full text-gray-400 hover:bg-gray-800 hover:text-white transition-colors">
                <IconX />
              </button>
            </header>
            <div className="flex-grow p-4 overflow-y-auto styled-scrollbar">
              {history.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {history.map((item) => (
                    <motion.div
                      key={item.timestamp}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: item.index * 0.05 }}
                      className="aspect-square bg-gray-800 rounded-md overflow-hidden group relative"
                    >
                      <img src={item.imageUrl} alt={item.id} className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300" />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button onClick={() => onEdit(item)} className="p-2 rounded-full bg-black/50 text-white hover:bg-yellow-500" title="Usar como Base"><IconEdit/></button>
                        <button onClick={() => onDownload(item, '1:1')} className="p-2 rounded-full bg-black/50 text-white hover:bg-green-500" title="Baixar"><IconDownload/></button>
                        <button onClick={() => onDelete(item.timestamp)} className="p-2 rounded-full bg-black/50 text-white hover:bg-red-500" title="Apagar"><IconTrash/></button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
                  <p className="text-lg">Seu histórico está vazio.</p>
                  <p className="text-sm mt-1">As imagens que você gerar aparecerão aqui.</p>
                </div>
              )}
            </div>
            {history.length > 0 && (
              <footer className="p-4 border-t border-gray-700">
                <Button onClick={onClearHistory} className="w-full flex items-center justify-center gap-2 text-red-400 border-red-500/50 hover:bg-red-500/20 hover:text-red-300">
                    <IconTrash />
                    Limpar Histórico
                </Button>
              </footer>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

const App = () => {
    // A chave agora é mantida no servidor/Vercel via endpoint /api/gemini
    const GEMINI_API_KEY = '';
    
    // Estado principal
    const [uploadedImage, setUploadedImage] = useState(null);
    const [generatedImages, setGeneratedImages] = useState([]);
    const [isLoading, setIsLoading] = useState(false);
    const [isSettingUp, setIsSettingUp] = useState(false);
    const [isDownloadingAlbum, setIsDownloadingAlbum] = useState(false);
    const [error, setError] = useState(null);
    const fileInputRef = useRef(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isCameraOpen, setIsCameraOpen] = useState(false);
    const resultsRef = useRef(null);
    const [isThemeSelectorOpen, setIsThemeSelectorOpen] = useState(false);
    const [mainPrompt, setMainPrompt] = useState('');
    const [numImages, setNumImages] = useState(4);
    const [editingImage, setEditingImage] = useState(null); // { index, imageUrl, id }
    const [history, setHistory] = useState([]);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [directClothingImage, setDirectClothingImage] = useState(null);
    const [isUploadingDirectClothing, setIsUploadingDirectClothing] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [isEnhancingPrompt, setIsEnhancingPrompt] = useState(false);
    const [proportion, setProportion] = useState('');
    
    // Estado de Perspectiva
    const [perspective, setPerspective] = useState('normal'); // 'normal', 'aerial', 'worm', 'custom'
    const [customAngle, setCustomAngle] = useState('frontal');
    const [perspectiveDescription, setPerspectiveDescription] = useState('');
    const [isEnhancingPerspective, setIsEnhancingPerspective] = useState(false);


    // Estado do tema
    const [template, setTemplate] = useState(null); // Começa como nulo para incentivar a seleção
    const [currentAlbumStyle, setCurrentAlbumStyle] = useState('');

    // Estado do Estilista de Cabelo
    const [hairColors, setHairColors] = useState([]);
    const [selectedHairStyles, setSelectedHairStyles] = useState([]);
    const [customHairStyle, setCustomHairStyle] = useState('');
    const [isCustomHairActive, setIsCustomHairActive] = useState(false);
    const [haircutImage, setHaircutImage] = useState(null);
    const [isUploadingHaircut, setIsUploadingHaircut] = useState(false);

    // Estado do Lookbook de Estilo
    const [lookbookStyle, setLookbookStyle] = useState('');
    const [customLookbookStyle, setCustomLookbookStyle] = useState('');
    const [clothingImage, setClothingImage] = useState(null);
    const [isUploadingClothing, setIsUploadingClothing] = useState(false);

    // Estado específico para Fotos Profissionais
    const [headshotExpression, setHeadshotExpression] = useState('Sorriso Amigável');
    const [headshotPose, setHeadshotPose] = useState('Frente');
    
    // Estado específico de Miniatura
    const [figurineAccessoryImage, setFigurineAccessoryImage] = useState(null);
    const [isUploadingAccessory, setIsUploadingAccessory] = useState(false);
    const [figurineBoxTitle, setFigurineBoxTitle] = useState('');
    
    // Estado específico para Personalizar
    const [cameraAngle, setCameraAngle] = useState('Nível dos Olhos');
    const [cameraLens, setCameraLens] = useState('Padrão (50mm)');
    const [lightingStyle, setLightingStyle] = useState('Natural');
    const [compositionStyle, setCompositionStyle] = useState('Como na foto original');
    const [subjectPose, setSubjectPose] = useState('Como na foto original');
    const [facialExpression, setFacialExpression] = useState('Como na foto original');
    const [backgroundOption, setBackgroundOption] = useState('manter');
    const [backgroundDescription, setBackgroundDescription] = useState('');

    // --- CHAT STATE ---
    const [isChatModalOpen, setIsChatModalOpen] = useState(false);
    const [chatHistory, setChatHistory] = useState([
        { role: 'model', text: "Olá! Sou seu engenheiro de prompts de IA pessoal. Tenho mais de 30 anos de experiência transformando ideias em obras de arte. Descreva sua ideia e eu posso criar um prompt profissional para você. Vamos começar?" }
    ]);
    const [chatInput, setChatInput] = useState('');
    const [isChatLoading, setIsChatLoading] = useState(false);
    
    // --- HISTORY NOTIFICATION STATE ---
    const [historyNotification, setHistoryNotification] = useState('');
    
    // Configuração do Sistema Gemini para o Chat
    const CHAT_SYSTEM_PROMPT = "Você é um engenheiro de prompts de IA com 30 anos de experiência, especialista em criar prompts de imagem de qualidade profissional. Seu objetivo é ajudar o usuário a transformar uma ideia em um prompt detalhado. Mantenha um tom amigável e conversacional. Use listas numeradas curtas para dar sugestões de estilo/detalhes (ex: 'Que tal um estilo... 1. Cyberpunk 2. Pintura a óleo 3. Fantasia'). Depois de uma resposta do usuário ou sugestão, **sempre pergunte**: 'Gostaria de entrar em mais detalhes sobre [último ponto mencionado, ex: iluminação/cor] ou posso criar o prompt final agora?' Ao gerar o prompt final, forneça-o diretamente, sem nenhuma introdução (ex: 'Aqui está o prompt...')";

     // Lógica do Histórico
    useEffect(() => {
        try {
            // Verificar se o histórico precisa ser limpo automaticamente
            clearHistoryIfNeeded();
            
            const storedHistory = localStorage.getItem('pictureMeHistory');
            if (storedHistory) {
                setHistory(JSON.parse(storedHistory));
            }
        } catch (e) {
            console.error("Não foi possível carregar o histórico:", e);
            setHistory([]);
        }
    }, []);

    const getSettingsForHistory = () => {
        return {
            template,
            mainPrompt,
            numImages,
            proportion,
            perspective, customAngle, perspectiveDescription,
            // Adicionar todos os outros estados relevantes aqui
            headshotExpression, headshotPose, lookbookStyle, customLookbookStyle,
            hairColors, selectedHairStyles, customHairStyle, isCustomHairActive,
            figurineBoxTitle,
            cameraAngle, cameraLens, lightingStyle, compositionStyle, subjectPose, facialExpression, backgroundOption, backgroundDescription
        };
    };

    const updateHistory = (newHistory) => {
        const limitedHistory = newHistory.slice(0, 50); // Limita o histórico a 50 itens
        setHistory(limitedHistory);
        try {
            localStorage.setItem('pictureMeHistory', JSON.stringify(limitedHistory));
        } catch (e) {
            console.error("Não foi possível salvar o histórico:", e);
        }
    };

    useEffect(() => {
        // Apenas atualiza o histórico quando uma geração é concluída
        if (!isLoading && generatedImages.some(img => img.status === 'success')) {
             const settings = getSettingsForHistory();
             const newSuccessfulImages = generatedImages
                .filter(img => img.status === 'success')
                .map(img => ({
                    id: img.id,
                    imageUrl: img.imageUrl,
                    timestamp: Date.now() + Math.random(), // Adiciona aleatoriedade para evitar colisão de chaves
                    settings: { ...settings, template: img.template } 
                }));

            if (newSuccessfulImages.length > 0) {
                 setHistory(prevHistory => {
                    const existingTimestamps = new Set(prevHistory.map(item => item.timestamp));
                    const uniqueNewImages = newSuccessfulImages.filter(item => !existingTimestamps.has(item.timestamp));
                    
                    if (uniqueNewImages.length > 0) {
                        const updatedHistory = [...uniqueNewImages, ...prevHistory];
                        const limitedHistory = updatedHistory.slice(0, 50);
                        try {
                            localStorage.setItem('pictureMeHistory', JSON.stringify(limitedHistory));
                        } catch (e) {
                            console.error("Não foi possível salvar o histórico:", e);
                        }
                        return limitedHistory;
                    }
                    return prevHistory;
                });
            }
        }
    }, [isLoading, generatedImages]);


    const handleClearHistory = () => {
        updateHistory([]);
    };

    // Função para limpar histórico automaticamente se necessário
    const clearHistoryIfNeeded = () => {
        try {
            const currentHistory = localStorage.getItem('pictureMeHistory');
            if (currentHistory) {
                const parsedHistory = JSON.parse(currentHistory);
                if (parsedHistory.length > 8) {
                    console.log("⚠️ Histórico muito grande, limpando automaticamente...");
                    localStorage.removeItem('pictureMeHistory');
                    setHistory([]);
                    setHistoryNotification('⚠️ Histórico limpo automaticamente');
                    setTimeout(() => setHistoryNotification(''), 3000);
                }
            }
        } catch (e) {
            console.error("Erro ao verificar histórico:", e);
            localStorage.removeItem('pictureMeHistory');
            setHistory([]);
        }
    };
    
    const handleDeleteHistoryImage = (timestampToDelete) => {
        const newHistory = history.filter(item => item.timestamp !== timestampToDelete);
        updateHistory(newHistory);
    };
    
    const handleEditHistoryImage = (image) => {
        const base64Image = image.imageUrl.split(',')[1];
        
        // Redefine todos os estados para o padrão, mas mantém a imagem
        handleStartOver(true); // pass true to keep image
        
        // Aplica as configurações salvas
        const settings = image.settings || {};
        setTemplate(settings.template || null);
        setMainPrompt(settings.mainPrompt || '');
        setNumImages(settings.numImages || 4);
        setProportion(settings.proportion || '');
        setPerspective(settings.perspective || 'normal');
        setCustomAngle(settings.customAngle || 'frontal');
        setPerspectiveDescription(settings.perspectiveDescription || '');
        setHeadshotExpression(settings.headshotExpression || 'Sorriso Amigável');
        setHeadshotPose(settings.headshotPose || 'Frente');
        setLookbookStyle(settings.lookbookStyle || '');
        setCustomLookbookStyle(settings.customLookbookStyle || '');
        setHairColors(settings.hairColors || []);
        setSelectedHairStyles(settings.selectedHairStyles || []);
        setCustomHairStyle(settings.customHairStyle || '');
        setIsCustomHairActive(settings.isCustomHairActive || false);
        setFigurineBoxTitle(settings.figurineBoxTitle || '');
        setCameraAngle(settings.cameraAngle || 'Nível dos Olhos');
        setCameraLens(settings.cameraLens || 'Padrão (50mm)');
        setLightingStyle(settings.lightingStyle || 'Natural');
        setCompositionStyle(settings.compositionStyle || 'Como na foto original');
        setSubjectPose(settings.subjectPose || 'Como na foto original');
        setFacialExpression(settings.facialExpression || 'Como na foto original');
        setBackgroundOption(settings.backgroundOption || 'manter');
        setBackgroundDescription(settings.backgroundDescription || '');

        setUploadedImage(base64Image); // Re-set uploaded image after reset
        
        // Fecha o painel de histórico e rola para o topo
        setIsHistoryOpen(false);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    
    const handleDownloadHistoryImage = (image, ratio) => {
        console.log("=== DOWNLOAD DO HISTÓRICO ===");
        console.log("Imagem:", image);
        console.log("Ratio:", ratio);
        
        // Usar imagem original se disponível, senão usar a comprimida
        const imageUrl = image.originalImageUrl || image.imageUrl;
        console.log("URL da imagem para download:", imageUrl ? "Disponível" : "Não disponível");
        
        handleDownloadRequest(imageUrl, image.id, ratio);
    };

    // Função para comprimir imagem drasticamente antes de salvar no histórico
    const compressImageForHistory = (imageUrl, quality = 0.1) => {
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Reduzir drasticamente o tamanho para economia máxima de espaço
                const maxWidth = 200;  // Reduzido de 400 para 200
                const maxHeight = 200; // Reduzido de 400 para 200
                let { width, height } = img;
                
                if (width > height) {
                    if (width > maxWidth) {
                        height = (height * maxWidth) / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width = (width * maxHeight) / height;
                        height = maxHeight;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                
                // Aplicar filtro de suavização para melhor qualidade em tamanho pequeno
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);
                
                // Usar qualidade muito baixa para JPEG
                const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
                
                console.log(`Imagem comprimida: ${width}x${height}, qualidade: ${quality}`);
                console.log(`Tamanho original: ~${Math.round(imageUrl.length / 1024)}KB`);
                console.log(`Tamanho comprimido: ~${Math.round(compressedDataUrl.length / 1024)}KB`);
                
                resolve(compressedDataUrl);
            };
            img.onerror = () => {
                console.warn("Erro ao comprimir imagem, usando original");
                resolve(imageUrl);
            };
            img.src = imageUrl;
        });
    };


    const handleColorChange = (index, newColor) => {
        setHairColors(prev => {
            const newColors = [...prev];
            newColors[index] = newColor;
            return newColors;
        });
    };

    const addHairColor = () => {
        if (hairColors.length < 2) {
            // Começa com uma cor de cabelo comum para melhor UX do que branco
            setHairColors(prev => [...prev, '#4a2c20']);
        }
    };

    const removeHairColor = (index) => {
        setHairColors(prev => prev.filter((_, i) => i !== index));
    };

    const handleHairStyleSelect = (styleId) => {
        if (styleId === 'Outro') {
            setIsCustomHairActive(prev => {
                const isActivating = !prev;
                // Verifica o limite apenas ao ativar
                if (isActivating && selectedHairStyles.length >= 6) {
                    setError("Você pode selecionar um máximo de 6 estilos.");
                    return prev; // cancela a ativação
                }
                if (!isActivating) setCustomHairStyle(''); // Limpa o texto na desativação
                return isActivating;
            });
            return;
        }
    
        setSelectedHairStyles(prev => {
            const isSelected = prev.includes(styleId);
            // Calcula o total com base no que está atualmente selecionado no estado
            const totalSelected = prev.length + (isCustomHairActive ? 1 : 0);
            
            if (isSelected) {
                // Sempre permite a desseleção
                return prev.filter(s => s !== styleId);
            }
            
            // Só permite a seleção se não exceder o limite
            if (totalSelected < 6) {
                return [...prev, styleId];
            }
            
            setError("Você pode selecionar um máximo de 6 estilos.");
            return prev; // Retorna o estado atual se o limite for atingido
        });
    };

    // Definições de Temas (Aprimoradas com ícones e descrições)
    const templates = useMemo(() => ({
        ensaioNatalino: {
            name: "Ensaio Natalino",
            description: "Transforme sua foto em uma lembrança festiva.",
            icon: '🎄',
            isPolaroid: false,
            prompts: [
                { id: 'Lareira Aconchegante', base: 'Em um cenário aconchegante, a pessoa está sentada perto de uma lareira acesa, vestindo um suéter de lã com tema natalino. Ao fundo, uma árvore de Natal lindamente decorada e luzes quentes criam uma atmosfera festiva.' },
                { id: 'Look Elegante', base: 'Em um ambiente elegante, a pessoa está em uma escadaria grandiosa, decorada com guirlandas e laços vermelhos. Ela veste uma roupa formal de festa (terno ou vestido de veludo). A iluminação é suave e sofisticada.' },
                { id: 'Cenário Nevado', base: 'Em um cenário externo mágico, a pessoa está em meio a uma paisagem de neve, com árvores cobertas de neve e luzinhas penduradas. Ela veste um casaco de inverno estiloso, cachecol e gorro.' },
                { id: 'Cozinha Festiva', base: 'Em uma cozinha festiva, a pessoa está se divertindo, usando um avental de Natal e cercada por ingredientes de biscoitos e decorações. O ambiente é alegre e caseiro.' }
            ]
        },
        streetwearDeLuxo: {
            name: "Streetwear de Luxo",
            description: "Sessão de moda urbana com uma atitude cool.",
            icon: '👟',
            isPolaroid: false,
            prompts: [
                { id: 'Look Vermelho', base: 'Foto de moda hiper-realista de corpo inteiro. A pessoa está sem camisa, vestindo calças vermelhas largas e botas vermelhas robustas. Uma jaqueta puffer vermelha cai dos ombros. Usa óculos pretos e um colar de prata, com as mãos nos bolsos.' },
                { id: 'Look All Black', base: 'Foto de moda hiper-realista de corpo inteiro. A pessoa veste um look todo preto: calças largas, botas de combate e uma jaqueta de couro aberta sobre o peito nu. Fundo de estúdio cinza escuro.' },
                { id: 'Rooftop ao Pôr do Sol', base: 'Foto de moda hiper-realista no terraço de um prédio ao pôr do sol. A pessoa, sem camisa, usa calças cargo largas de cor cáqui e tênis de cano alto. Uma jaqueta bomber está pendurada em um ombro.' },
                { id: 'Pose Inclinada', base: 'Foto de moda hiper-realista de corpo inteiro. A pessoa está inclinada contra uma parede de concreto, vestindo jeans largos rasgados e botas pesadas, sem camisa. A jaqueta está no chão ao lado.' },
            ]
        },
        urbanoFuturista: {
            name: "Urbano Futurista",
            description: "Ensaio com estética de campanha Balenciaga.",
            icon: '🏙️',
            isPolaroid: false,
            prompts: [
                { id: 'Concreto e Grafite', base: 'Imagem hiper-realista em cenário urbano futurista com prédios de concreto e grafites. A pessoa usa calça oversized, botas robustas e jaqueta aberta em cor vibrante. Iluminação cinematográfica, estilo revista GQ.' },
                { id: 'Hora Dourada', base: 'Imagem hiper-realista em um viaduto de uma cidade futurista durante a hora dourada. A pessoa veste um conjunto fashion-forward prateado metálico. A luz do sol reflete nos prédios.' },
                { id: 'Jaqueta Neon', base: 'Imagem hiper-realista em uma viela urbana à noite. A pessoa usa calças cargo pretas, botas táticas e uma jaqueta puffer verde neon aberta, iluminada por luzes da cidade.' },
                { id: 'Caminhando', base: 'Imagem hiper-realista da pessoa caminhando em direção à câmera em uma passarela de pedestres elevada em uma cidade futurista. Roupa monocromática e estruturada. Estilo campanha de moda.' },
            ]
        },
        luxoNoturno: {
            name: "Luxo Noturno",
            description: "Campanha de moda com carros e luzes de neon.",
            icon: '🏎️',
            isPolaroid: false,
            prompts: [
                { id: 'Carro Esportivo', base: 'Imagem hiper-realista ao lado de um carro esportivo de luxo em uma rua urbana noturna iluminada por letreiros de neon. A pessoa, com pose confiante e mão no carro, veste um sobretudo preto aberto, calça oversized e botas.' },
                { id: 'Lamborghini Branco', base: 'Imagem hiper-realista ao lado de uma Lamborghini branca. A pessoa veste um look todo branco, com um sobretudo de lã aberto. A cena é uma rua molhada de chuva à noite, refletindo as luzes de neon azul e rosa.' },
                { id: 'Olhar de Dentro', base: 'Imagem hiper-realista vista do assento do motorista de um carro de luxo, olhando para a pessoa do lado de fora. Ela está inclinada, olhando para dentro do carro, vestindo uma jaqueta de couro e calças de alfaiataria.' },
                { id: 'Entrada do Hotel', base: 'Imagem hiper-realista da pessoa saindo de um McLaren preto na frente de um hotel de luxo à noite. Ela usa um smoking moderno com o paletó aberto. Paparazzi ao fundo desfocados.' },
            ]
        },
        undergroundFuturista: {
            name: "Underground Futurista",
            description: "Ensaio de streetwear em um túnel de metrô.",
            icon: '🚇',
            isPolaroid: false,
            prompts: [
                { id: 'Túnel de Metrô', base: 'Imagem hiper-realista em um túnel de metrô abandonado com luzes de neon refletindo nas paredes e fumaça no ambiente. A pessoa veste um look monocromático ousado: calça larga, botas pesadas e casaco aberto. Iluminação dramática e contrastante.' },
                { id: 'Neon Vermelho', base: 'Imagem hiper-realista no mesmo túnel, mas iluminado predominantemente por uma luz de neon vermelha. A pessoa está sentada nos trilhos, olhando para cima. O look é todo preto para contrastar com a luz.' },
                { id: 'Grafite e Luz', base: 'Imagem hiper-realista em um túnel de metrô coberto de grafites coloridos. A pessoa está em pé contra a parede, iluminada por um único feixe de luz branca vindo de cima. Usa um conjunto cinza oversized.' },
                { id: 'Movimento Borrado', base: 'Imagem hiper-realista com a pessoa parada no meio do túnel enquanto as luzes de um trem que passa criam um rastro de luz borrado ao fundo. A pose é estática e poderosa, com um look escuro.' },
            ]
        },
        fashionEditorial: {
            name: "Editorial de Moda",
            description: "Torne-se a capa de uma revista de moda.",
            icon: '📸',
            isPolaroid: false,
            prompts: [
                { id: 'Look Tanque', base: 'Foto editorial de alta-costura em um estúdio com iluminação cinematográfica, sombras temperamentais e luz dourada suave. A pessoa usa uma regata branca. Efeito de dupla exposição borrada, estilo artístico de revista GQ, fundo mínimo.' },
                { id: 'Look Terno', base: 'Foto editorial de alta-costura em um estúdio com iluminação cinematográfica, estilo GQ. A pessoa, vestindo um terno preto sob medida, está sentada casualmente em uma cadeira. Iluminação de estúdio temperamental com sombras cinematográficas, fundo mínimo.' },
                { id: 'Passarela', base: 'Foto de moda de corpo inteiro da pessoa andando em direção à câmera em uma roupa vanguardista. Cenário de estúdio com um único holofote forte criando uma longa sombra. Dinâmico e poderoso.' },
                { id: 'Close-up Beleza', base: 'Close-up de beleza em estilo editorial. Iluminação suave e difusa vinda da frente para destacar os traços. O fundo é uma parede texturizada simples e desfocada, estilo revista Vogue.' },
            ]
        },
        cinematicPortrait: {
            name: "Retrato Cinematográfico",
            description: "Fotos de estúdio com iluminação dramática.",
            icon: '🎬',
            isPolaroid: false,
            prompts: [
                { id: 'Luzes de Neon', base: 'Retrato cinematográfico, sem camisa, olhando para a câmera com expressão séria. Textura de pele detalhada, iluminação dramática com luz frontal azul-petróleo e luz de contorno laranja quente. Fundo preto escuro, alto contraste, estilo realista, ultra detalhado.' },
                { id: 'Sombra Intensa', base: 'Retrato cinematográfico em close-up com olhar intenso, sombras obscurecendo parcialmente o rosto. Luz principal dramática de um lado em tom azul frio, com luz de preenchimento quente sutil. Fundo preto.' },
                { id: 'Contraluz Roxo', base: 'Retrato da altura dos ombros, olhando ligeiramente para longe da câmera, expressão contemplativa. Iluminação de três pontos com uma forte luz de fundo roxa criando um efeito de auréola, luz principal verde suave e sombras profundas.' },
                { id: 'Film Noir', base: 'Retrato cinematográfico em ângulo baixo, olhando para baixo em direção à câmera com uma expressão poderosa. Iluminação dura e direta de cima em um branco forte, criando sombras fortes sob os traços faciais, contra um fundo totalmente preto. Sensação de alto contraste, film noir.' },
            ]
        },
        editorialTechRetro: {
            name: "Retrô-Tecnológico Editorial",
            description: "Estúdio de alta moda com acessórios retrô/futuristas. Foco no look e drama (Prompt 1 e 3 do usuário).",
            icon: '☎️',
            isPolaroid: false,
            prompts: [
                { id: 'Terno Cinza (Ângulo Baixo)', base: 'Crie um retrato fotográfico meu em estúdio com fundo branco minimalista. Eu estou vestindo um elegante terno cinza de corte moderno, abotoado, com gravata preta e camisa branca. Eu seguro um telefone fixo branco com fio, trazendo o fone para perto da câmera em primeiro plano, de forma impactante. Eu uso óculos espelhados futuristas com corrente prateada lateral. A câmera está posicionada em ângulo baixo e próximo, dando um efeito dramático e cinematográfico. O estilo deve ser nítido, editorial de moda, com iluminação suave e contraste perfeito, realçando a sofisticação do look. Close dramático e cinematográfico. Qualidade 4K.' },
                { id: 'Terno Azul Marinho (Sentado)', base: 'Crie um retrato fotográfico em estúdio com fundo branco minimalista. Eu estou sentado em uma cadeira de couro preta, vestindo um terno azul marinho de dois botões, colete, gravata borboleta e óculos de sol redondos. O estilo é nítido, limpo e editorial, com iluminação de estúdio suave. Foco no look sofisticado e minimalista. ' },
            ]
        },
        mysteriousEditorial: {
            name: "Editorial Misterioso (Olhar)",
            description: "Retratos dramáticos que brincam com o olhar e a sombra dos óculos (Prompt 2 do usuário).",
            icon: '🧐',
            isPolaroid: false,
            prompts: [
                { id: 'Terno Marrom (Olhar para Baixo)', base: 'Retrato fotográfico editorial em estúdio com fundo branco minimalista. Homem elegante vestindo terno marrom sofisticado de corte moderno, camisa branca e gravata cinza. Ele usa óculos espelhados futuristas com corrente prateada lateral. O homem segura um telefone fixo branco com fio, posicionado de forma impactante. Estilo clean, nítido, digno de revista de moda, iluminação suave e contrastada. O homem olha para baixo através dos óculos espelhados futuristas, criando atmosfera misteriosa e artística. Foco no olhar.' },
                { id: 'Alto Contraste (Luz de Rembrandt)', base: 'Retrato cinematográfico em estúdio, P&B, de alto contraste. O homem veste um sobretudo preto. O rosto é parcialmente coberto por óculos escuros. A iluminação é estritamente a luz de Rembrandt (triângulo de luz na bochecha), criando uma atmosfera misteriosa e sombria. O olhar é intenso e direto para a câmera. ' },
            ]
        },
        architectStyle: {
            name: "Estilo de Arquiteto (Corporate Fashion)",
            description: "Foco em acessórios de negócios com estilo fashion (Prompt 3 do usuário).",
            icon: '📐',
            isPolaroid: false,
            prompts: [
                { id: 'Plantas no Bolso (Post-it)', base: 'Crie um retrato fotográfico editorial em estúdio, com fundo branco minimalista e iluminação limpa. Um homem elegante veste um terno marrom de alfaiataria, camisa branca impecável e gravata cinza. No bolso do paletó, há uma folha de papel presa com clipe vermelho metálico, contendo plantas arquitetônicas dobradas. No mesmo paletó, há um post-it amarelo colado com o nome do usuário escrito à mão. O estilo deve ser fotorrealista, corporativo, mas com um toque fashion-forward.' },
                { id: 'Terno Azul (Tablet e Cidade)', base: 'Retrato fotográfico de negócios, de meio-corpo. O homem está de pé em um terraço com vista para uma cidade moderna, vestindo um terno azul-claro de alfaiataria e segurando um tablet de designer na mão. O estilo é clean, bem iluminado pela luz da manhã, com o fundo da cidade desfocado. ' },
            ]
        },
        styleLookbook: {
            name: "Lookbook de Estilo",
            description: "Sua sessão de fotos de moda pessoal.",
            icon: '👕',
            isPolaroid: false,
            styles: [
                'Clássico / Casual', 'Streetwear', 'Vintage', 'Gótico', 'Preppy', 'Minimalista', 
                'Athleisure', 'Old Money / Luxo Discreto', 'Boêmio (Boho)', 'Business Casual', 
                'Grunge anos 90', 'Cocktail / Formal'
            ],
            prompts: [
                { id: 'Visual 1', base: 'uma foto de corpo inteiro, em pé' },
                { id: 'Visual 2', base: 'uma foto de meio corpo, sorrindo' },
                { id: 'Visual 3', base: 'uma foto espontânea andando' },
                { id: 'Visual 4', base: 'uma foto mostrando detalhes da roupa' },
                { id: 'Visual 5', base: 'uma pose sentada' },
                { id: 'Visual 6', base: 'um close-up focado nos acessórios' },
            ]
        },
        hairStyler: {
            name: 'Estilista de Cabelo',
            description: 'Experimente novos penteados e cores.',
            icon: '💇‍♀️',
            isPolaroid: false,
            prompts: [
                { id: 'Curto', base: 'um penteado curto' },
                { id: 'Médio', base: 'um penteado de comprimento médio' },
                { id: 'Longo', base: 'um penteado longo' },
                { id: 'Liso', base: 'cabelo liso' },
                { id: 'Ondulado', base: 'cabelo ondulado' },
                { id: 'Cacheado', base: 'cabelo cacheado' },
            ]
        },
        figurinha: {
            name: "Figurinha",
            description: "Transforme sua foto em uma figurinha divertida.",
            icon: '🖼️',
            isPolaroid: false,
            prompts: [
                { id: 'Figurinha Personalizada', base: '' },
            ]
        },
        decades: {
            name: 'Viajante do Tempo',
            description: 'Veja-se através das décadas.',
            icon: '⏳',
            isPolaroid: true,
            prompts: [
                { id: '1950s', base: 'Um retrato no estilo dos anos 1950.' },
                { id: '1960s', base: 'Um retrato no estilo dos anos 1960.' },
                { id: '1970s', base: 'Um retrato no estilo dos anos 1970.' },
                { id: '1980s', base: 'Um retrato no estilo dos anos 1980.' },
                { id: '1990s', base: 'Um retrato no estilo dos anos 1990.' },
                { id: '2000s', base: 'Um retrato no estilo dos anos 2000.' },
            ]
        },
        figurines: {
            name: 'Miniatura de Mim',
            description: 'Sua própria estatueta colecionável.',
            icon: '🧍‍♂️',
            isPolaroid: false,
            prompts: [
                { id: 'Embalagem Retrô', base: 'uma embalagem de action figure estilo retrô dos anos 90 com arte de fundo vibrante e uma bolha de plástico transparente.' },
                { id: 'Caixa de Colecionador', base: 'uma caixa de colecionador moderna e minimalista com uma grande janela de exibição e design gráfico elegante.' },
                { id: 'Art Toy', base: 'uma caixa de "blind box" de art toy, misteriosa e estilizada.' },
                { id: 'Super-herói', base: 'uma embalagem de figura de super-herói com logotipos explosivos e poses de ação.' },
                { id: 'Fantasia', base: 'uma caixa com tema de fantasia com runas místicas e arte de castelo ao fundo.' },
                { id: 'Exclusivo', base: 'uma embalagem de edição limitada exclusiva de convenção com adesivos holográficos.' },
            ]
        },
        eightiesMall: {
            name: "Sessão de Fotos anos 80",
            description: "Retratos totalmente tubulares dos anos 80.",
            icon: '📼',
            isPolaroid: false,
            prompts: [
                { id: 'Sorrindo', base: 'uma pose amigável e sorridente' },
                { id: 'Pensativo', base: 'uma pose pensativa, olhando para longe da câmera' },
                { id: 'Divertido', base: 'uma pose divertida e rindo' },
                { id: 'Sério', base: 'uma pose séria e dramática' },
                { id: 'Mão no Queixo', base: 'posando com a mão no queixo' },
                { id: 'Por Cima do Ombro', base: 'olhando para trás por cima do ombro' },
            ]
        },
        impossibleSelfies: {
            name: 'Fotos Impossíveis',
            description: 'Fotos que desafiam a realidade.',
            icon: '🚀',
            isPolaroid: false,
            prompts: [
                { id: 'Com Lincoln', base: 'A pessoa posando com Abraham Lincoln, que também está fazendo um sinal de paz e mostrando a língua. Mantenha o local original.' },
                { id: 'Alien e Bolhas', base: 'A pessoa posando ao lado de um alienígena realista segurando duas pistolas de bolhas, soprando milhares de bolhas. Mantenha a pose da pessoa e o local original.' },
                { id: 'Sala de Filhotes', base: 'A pessoa posando em uma sala cheia de cem filhotes diferentes.' },
                { id: 'Marionetes Cantantes', base: 'A pessoa posando em uma sala cheia de grandes, fantásticos e coloridos bonecos de feltro que estão cantando.' },
                { id: 'Nugget de Frango Gigante', base: 'A pessoa posando com o braço em volta de um nugget de frango de 1,20 metro. Mantenha a expressão facial da pessoa exatamente a mesma.' },
                { id: 'Yeti Photobomb', base: 'Adicione um yeti realista ao lado da pessoa no lado esquerdo da foto, combinando a iluminação. Mantenha a pose e o rosto da pessoa exatamente iguais.' },
            ]
        },
        headshots: {
            name: "Fotos Profissionais",
            description: "Fotos de perfil profissionais.",
            icon: '💼',
            isPolaroid: false,
            prompts: [
                { id: 'Terno de Negócios', base: 'vestindo um terno de negócios escuro com uma camisa branca impecável' },
                { id: 'Casual Elegante', base: 'vestindo um suéter de malha casual elegante sobre uma camisa de colarinho' },
                { id: 'Profissional Criativo', base: 'vestindo uma gola alta escura' },
                { id: 'Visual Corporativo', base: 'vestindo uma camisa de botão azul clara' },
                { id: 'Moderno e Brilhante', base: 'vestindo um blazer colorido' },
                { id: 'Descontraído', base: 'vestindo uma camiseta simples de alta qualidade sob uma jaqueta casual' },
            ]
        },
        blackAndWhite: {
            name: "Preto e Branco",
            description: "Retratos clássicos e atemporais.",
            icon: '🎨',
            isPolaroid: false,
            prompts: [
                { id: 'Alto Contraste', base: 'um retrato em preto e branco de alto contraste com sombras dramáticas' },
                { id: 'Suave', base: 'um retrato suave em preto e branco com tons de cinza suaves' },
                { id: 'Film Noir', base: 'um retrato no estilo film noir em preto e branco com iluminação misteriosa' },
                { id: 'Sépia', base: 'um retrato com um tom sépia quente para um visual vintage' },
                { id: 'Grão de Filme', base: 'um retrato em preto e branco com uma textura de grão de filme' },
                { id: 'Minimalista', base: 'um retrato minimalista em preto e branco contra um fundo limpo' },
            ]
        },
        ghibli: {
            name: "Estilo Ghibli",
            description: "Transforme-se em um personagem de anime.",
            icon: '🎌',
            isPolaroid: false,
            prompts: [
                { id: 'Pastel', base: 'com um estilo de pintura à mão e cores suaves e pastéis' },
                { id: 'Detalhado', base: 'com foco em detalhes da natureza e do ambiente original' },
                { id: 'Nostálgico', base: 'com iluminação quente e uma atmosfera nostálgica' },
                { id: 'Expressivo', base: 'com traços limpos e um rosto muito expressivo' },
                { id: 'Fantasia', base: 'com um toque de fantasia e maravilha adicionado à cena' },
                { id: 'Sereno', base: 'com uma atmosfera geral serena e pacífica' },
            ]
        },
        pixar: {
            name: "Estilo Pixar",
            description: "Veja-se como uma animação 3D.",
            icon: '🧸',
            isPolaroid: false,
            prompts: [
                { id: 'Cinematográfico', base: 'com iluminação cinematográfica e texturas de superfície detalhadas' },
                { id: 'Caricato', base: 'com características faciais ligeiramente exageradas e caricatas' },
                { id: 'Suave', base: 'com um visual suave e arredondado, típico de animações 3D' },
                { id: 'Vibrante', base: 'com cores vibrantes e altamente saturadas' },
                { id: 'Brilhante', base: 'com um brilho sutil na renderização e reflexos nos olhos' },
                { id: 'Expressivo', base: 'com foco na expressividade dos olhos e sobrancelhas' },
            ]
        },
        simpsons: {
            name: "Estilo Simpsons",
            description: "Vire um morador de Springfield.",
            icon: '🍩',
            isPolaroid: false,
            prompts: [
                { id: 'Clássico', base: 'com contornos pretos grossos e cores chapadas' },
                { id: 'Olhos Grandes', base: 'com os olhos grandes, brancos e redondos característicos' },
                { id: 'Sobremordida', base: 'com uma ligeira sobremordida para se assemelhar aos personagens' },
                { id: '2D', base: 'em um estilo de animação 2D bem simples e direto' },
                { id: 'Cores Primárias', base: 'mantendo a paleta de cores primárias do desenho' },
                { id: 'Cômico', base: 'com um toque cômico na expressão facial' },
            ]
        },
        spotlightPortrait: {
            name: "Retrato com Holofote",
            description: "Retrato cinematográfico P&B com iluminação dramática.",
            icon: '🔦',
            isPolaroid: false,
            prompts: [
                { id: 'Luz Focada', base: 'A dramatic black and white portrait of my uploaded photo/ standing under a single spotlight, looking down with a serious, introspective expression. The background is completely dark, high contrast lighting emphasizing the texture of his t-shirt and veins on his arms. Studio shot, moody atmosphere, cinematic lighting, realistic details. Preserve face 100% pov is left side' }
            ]
        },
        cinematicStreetStyle: {
            name: "Estilo de Rua Cinematográfico",
            description: "Ensaio de rua com um visual de filme de alta moda (Prompt 4 do usuário).",
            icon: '🕶️',
            isPolaroid: false,
            prompts: [
                { id: 'Casaco de Lã (Ângulo Lateral)', base: "Um retrato cinematográfico altamente realista da pessoa na foto de referência. O modelo está usando óculos escuros elegantes, uma camisa escura com um casaco oversized de lã cinza por cima. Ele está em uma rua, capturado em um momento espontâneo de street photography, com iluminação dramática e sombras. A expressão é séria e confiante. O fundo mostra pessoas borradas e um fotógrafo segurando uma câmera. O clima geral é temperamental, cinematográfico e fashion-forward." },
                { id: 'Estilo Neo-Noir (Chuva)', base: 'Foto de rua cinematográfica em uma noite chuvosa. O modelo está sob a luz fraca de um poste de rua, vestindo um trench coat preto e segurando um guarda-chuva transparente. O reflexo das luzes de neon na rua molhada cria um visual neo-noir. O olhar é direto e intenso. ' }
            ]
        },
        shadowPortrait: {
            name: "Retrato com Sombras",
            description: "Retrato artístico com sombras de persiana.",
            icon: '🪟',
            isPolaroid: false,
            prompts: [
                { id: 'Luz de Janela', base: 'Portrait photo of a stylish man sitting on a wooden chair in a minimalistic dark room. He is wearing a black turtleneck sweater and dark sunglasses. His arms are crossed casually on the top of the chair, with a confident and relaxed posture. Dramatic lighting with shadows from window blinds cast across his face, arms, and background, creating an artistic and cinematic atmosphere. High-resolution, editorial photography style, moody and sophisticated aesthetic.' }
            ]
        },
        viceCityStyle: {
            name: "Estilo Vice City",
            description: "Torne-se um personagem no mundo de GTA Vice City.",
            icon: '🌴',
            isPolaroid: false,
            prompts: [
                { id: 'Ação em Vice City', base: "Ultra-detailed cinematic artwork in the style of GTA Vice City. A vibrant 1980s neon city scene at night, inspired by Miami. In the middle of the street, Tommy Vercetti stands as the main character, wearing his iconic light blue Hawaiian shirt, blue denim jeans, and completely white sneakers. Instead of Tommy's original face, use the provided reference face exactly (make sure the character's face matches the Behind him, the city is alive: the Malibu Club glowing with a neon sign that clearly says 'MALIBU', palm trees swaying, retro 80s sports cars parked nearby, and crowds of pedestrians - bar women, dancers, and random people walking. Police are chasing him with a 3-star wanted level: siren-lit police cars approaching, officers aiming their guns, and a helicopter spotlight shining down from the sky. In the background, another huge neon sign in Vice City font style (retro pink-and-blue glow) displays the words 'FarukCreative City'. The whole scene is hyperrealistic, cinematic, with strong neon reflections on wet asphalt, ultra high resolution, perfectly capturing the Vice City vibe." }
            ]
        },
        urbanNeon: {
            name: "Neon Urbano",
            description: "Retrato de rua futurista com brilho de neon.",
            icon: '✨',
            isPolaroid: false,
            prompts: [
                { id: 'Brilho Dourado', base: "A cinematic urban portrait of me, keeping my real face unchanged. I am standing upright, viewed from a low angle, which makes me appear taller and more dominant in the frame. My head is tilted slightly upward, and my gaze is directed above the camera, as if I am looking toward the light, creating a confident and thoughtful expression. My lips are closed, and my jawline is accentuated by the lighting. My arms rest naturally by my sides, out of the main focus, keeping the pose strong and minimal. I am wearing a thick, oversized puffer jacket in a matte dark color, with a high collar that adds volume around my neck and shoulders. The jacket's fabric has a smooth, padded texture that reflects the ambient light, emphasizing its structure. On my face, I am wearing large, modern eyeglasses with a thick, dark frame, adding a bold accessory detail to the look. My hairstyle is slightly curly and voluminous, complementing the casual but stylish streetwear vibe. The background is filled with glowing neon yellow-orange light, with a large curved LED-like streak arching across behind me, creating a futuristic and dynamic atmosphere. The warm illumination casts dramatic highlights and shadows across my face and jacket, bathing the entire scene in golden tones. The camera angle is from below (low- angle shot), emphasizing perspective and strength, while framed from the chest up. The lens resembles a portrait focal length around 50-85mm, keeping natural proportions but enhancing depth and intensity. Style: cinematic, urban streetwear, futuristic neon glow, moody low-angle portrait, modern fashion photography." }
            ]
        },
        bwProfile: {
            name: "Perfil P&B",
            description: "Retrato introspectivo e elegante em preto e branco.",
            icon: '🔳',
            isPolaroid: false,
            prompts: [
                { id: 'Momento de Calma', base: "A cinematic black and white portrait of me, keeping my real face unchanged. I am standing in profile, leaning with my back against a smooth wall, my posture relaxed yet elegant. My head is tilted slightly backward, chin raised, and my eyes are closed, giving the impression of calmness and introspection. My left arm rests naturally along my body, while my right arm is bent at the elbow, holding a clear glass tumbler near waist height with a relaxed grip. am wearing a crisp, fitted white button-down shirt with the sleeves casually rolled up to the elbows, the fabric slightly stretched across my chest and arms, emphasizing a tailored silhouette. The shirt is tucked neatly into a pair of dark, well-fitted trousers, secured with a slim black belt. No additional accessories, keeping the look timeless and minimalistic.The lighting is dramatic and high-contrast, with soft highlights defining my facial structure, shirt creases, and the glass, while deep shadows enhance the mood of the scene. The monochrome tones c" }
            ]
        },
        projectedSilhouette: {
            name: "Silhueta Projetada",
            description: "Retrato P&B artístico com foco na sombra do perfil.",
            icon: '👤',
            isPolaroid: false,
            prompts: [
                { id: 'Jogo de Sombras', base: "GENERATE A BLACK AND WHITE CINEMATIC STUDIO PORTRAIT OF A PERSON SITTING IN PROFILE VIEW, FACING SIDEWAYS. THE SUBJECT IS ILLUMINATED BY A STRONG DIRECTIONAL LIGHT SOURCE, CASTING A DISTINCT SHADOW OF THEIR PROFILE ON THE WALL BEHIND THEM LIGHTING: DRAMATIC SINGLE LIGHT SETUP, POSITIONED TO CREATE HIGH-CONTRAST CHIAROSCURO WITH SHARP SHADOWS. THE SHADOW OF THE SUBJECT SHOULD BE CLEARLY VISIBLE ON THE WALL. RESEMBLING A PROJECTED SILHOUETTE. BACKGROUND: PLAIN STUDIO WALL WITH A FAINT WINDOW-LIKE LIGHT PATTERN, ADDING DEPTH AND A SUBTLE ARCHITECTURAL FEEL CAMERA & COMPOSITION: MEDIUM PORTRAIT SHOT, FRAMED FROM THE WAIST UP, EMPHASIZING THE PROFILE AND INTERPLAY BETWEEN SUBJECT AND SHADOW. LENS 50-85 FOR SHARPNESS AND NATURAL PROPORTIONS STYLE: FINE-ART BLACK AND WHITE PHOTOGRAPHY WITH A CINEMATIC EDITORIAL MOOD, MINIMALISTIC AND TIMELESS. NEGATIVES: NO TEXT, NO LOGOS, NO WATERMARKS, NO CLUTTER OR DISTRACTING OBJECTS. NO COLOR (STRICTLY MONOCHROME). QUALITY: ULTRA-RE." }
            ]
        },
        popMagazineCover: {
            name: "Capa de Revista Pop",
            description: "Capa de revista de alta moda com glamour retrô-pop.",
            icon: '🛁',
            isPolaroid: false,
            prompts: [
                { id: 'Glamour Aquático', base: "Crie uma capa de revista editorial de alta moda inspirada em glamour retrô-pop. Use minha foto como modelo principal, posicionado dentro de uma banheira com água verde-turquesa, parcialmente submerso, ombros e parte do tronco visíveis. A iluminação deve destacar o rosto e corpo com contraste entre pele iluminada e reflexos aquáticos esverdeados. Vista o modelo com uma camisa laranja com colar de correntes e pedras prateadas brilhantes, no estilo joias cravejadas, e adicione pulseira no braço. A atmosfera deve ser sensual e luxuosa, mas artística, com reflexos da água distorcendo parte da imagem. Inclua elementos gráficos geométricos: recortes e retângulos translúcidos sobrepostos, criando uma composição editorial. No fundo, repita fragmentos do corpo do modelo em mosaico artístico. O resultado deve ter estética de capa de revista, sofisticada, glamourosa e moderna. Resolução 8K." }
            ]
        },
        personalizar: {
            name: "Personalizar",
            description: "Controle a cena e a câmera.",
            icon: '🎛️',
            isPolaroid: false,
            prompts: [
                { id: 'Imagem Personalizada', base: '' },
            ]
        },
    }), []);

    // Função para adicionar imagem ao histórico automaticamente
    const addImageToHistory = async (imageData) => {
        console.log("=== SALVANDO NO HISTÓRICO ===");
        console.log("Dados da imagem:", imageData);
        
        if (!imageData || !imageData.imageUrl) {
            console.error("❌ Dados de imagem inválidos para salvar no histórico");
            setHistoryNotification('❌ Erro: Imagem inválida');
            setTimeout(() => setHistoryNotification(''), 3000);
            return;
        }

        try {
            // Comprimir a imagem antes de salvar
            console.log("Comprimindo imagem para histórico...");
            const compressedImageUrl = await compressImageForHistory(imageData.imageUrl);
            console.log("✅ Imagem comprimida com sucesso");

        const historyEntry = {
            id: Date.now() + Math.random(),
            timestamp: new Date().toISOString(),
                imageUrl: compressedImageUrl, // Usar versão comprimida
                originalImageUrl: imageData.imageUrl, // Manter original para downloads
            template: imageData.template,
            prompt: imageData.prompt,
            era: imageData.era,
            settings: getSettingsForHistory(),
                proportion: imageData.proportion,
            ...imageData
        };

            console.log("Entrada do histórico criada:", historyEntry);

        setHistory(prevHistory => {
            const newHistory = [historyEntry, ...prevHistory];
                const limitedHistory = newHistory.slice(0, 5); // Reduzir para apenas 5 itens
                
                try {
                    const historyString = JSON.stringify(limitedHistory);
                    console.log(`Tentando salvar ${limitedHistory.length} itens no localStorage`);
                    console.log(`Tamanho do histórico: ${historyString.length} caracteres`);
                    
                    localStorage.setItem('pictureMeHistory', historyString);
                    
                    // Verificar se foi realmente salvo
                    const saved = localStorage.getItem('pictureMeHistory');
                    if (saved) {
                        console.log("✅ Histórico salvo com sucesso!");
                // Mostrar notificação de sucesso
                setHistoryNotification('✅ Imagem salva no histórico!');
                setTimeout(() => setHistoryNotification(''), 3000);
                    } else {
                        throw new Error("Falha ao verificar salvamento");
                    }
            } catch (e) {
                    console.error("❌ Erro ao salvar no histórico:", e);
                    console.error("Nome do erro:", e.name);
                    console.error("Mensagem:", e.message);
                    
                    // Se o erro for de quota excedida, limpar completamente
                    if (e.name === 'QuotaExceededError') {
                        console.log("⚠️ Quota excedida, limpando localStorage completamente...");
                        try {
                            // Limpar todo o localStorage relacionado
                            localStorage.removeItem('pictureMeHistory');
                            localStorage.removeItem('pictureMeSettings');
                            
                            setHistoryNotification('⚠️ Histórico limpo por espaço');
                            setTimeout(() => setHistoryNotification(''), 3000);
                            return []; // Retornar array vazio
                        } catch (e2) {
                            console.error("❌ Falha ao limpar histórico:", e2);
                            // Se ainda falhar, não salvar nada
                            setHistoryNotification('⚠️ Impossível salvar - localStorage cheio');
                            setTimeout(() => setHistoryNotification(''), 3000);
                            return [];
                        }
                    }
                    
                setHistoryNotification('❌ Erro ao salvar no histórico');
                setTimeout(() => setHistoryNotification(''), 3000);
            }
            
            return limitedHistory;
        });
        } catch (error) {
            console.error("❌ Erro ao comprimir imagem:", error);
            setHistoryNotification('❌ Erro ao processar imagem');
            setTimeout(() => setHistoryNotification(''), 3000);
        }
    };

    const regenerateImageAtIndex = async (imageIndex) => {
        const imageToRegenerate = generatedImages[imageIndex];
        if (!imageToRegenerate) return;
    
        setGeneratedImages(prev => prev.map((img, index) =>
            index === imageIndex ? { ...img, status: 'pending' } : img
        ));
        setError(null);
    
        const generationMode = imageToRegenerate.template || 'promptBased';
        const activeTemplate = templates[generationMode];
        let promptsForGeneration;

        if (generationMode === 'promptBased') {
            promptsForGeneration = [{ id: 'Imagem Personalizada', base: imageToRegenerate.prompt }];
        } else if (generationMode === 'personalizar' || generationMode === 'figurinha' || generationMode === 'editorialTechRetro' || generationMode === 'mysteriousEditorial' || generationMode === 'architectStyle' || generationMode === 'spotlightPortrait' || generationMode === 'cinematicStreetStyle' || generationMode === 'shadowPortrait' || generationMode === 'viceCityStyle' || generationMode === 'urbanNeon' || generationMode === 'bwProfile' || generationMode === 'projectedSilhouette' || generationMode === 'popMagazineCover') {
            promptsForGeneration = activeTemplate.prompts;
        } else if (generationMode === 'hairStyler' && haircutImage) {
            promptsForGeneration = [{ id: 'Corte da Referência', base: '' }];
        } else if (generationMode === 'styleLookbook' && clothingImage) {
            promptsForGeneration = activeTemplate.prompts.slice(0, 2);
        } else if (generationMode === 'hairStyler') {
            const selectedPrompts = activeTemplate.prompts.filter(p => selectedHairStyles.includes(p.id));
            if (isCustomHairActive && customHairStyle.trim() !== '') {
                selectedPrompts.push({ id: customHairStyle, base: customHairStyle });
            }
            promptsForGeneration = selectedPrompts;
        } else {
            promptsForGeneration = activeTemplate.prompts;
        }
    
        const prompt = promptsForGeneration[imageIndex];

        if (!prompt) {
            setError("Não foi possível encontrar o prompt para gerar novamente.");
            setGeneratedImages(prev => prev.map((img, index) => index === imageIndex ? { ...img, status: 'failed' } : img));
            return;
        }
    
        try {
            if (generationMode === 'eightiesMall' && !currentAlbumStyle) {
                throw new Error("Não é possível gerar novamente sem um estilo de álbum. Por favor, comece de novo.");
            }
            if (generationMode === 'styleLookbook' && !clothingImage && (lookbookStyle === '' || (lookbookStyle === 'Outro' && customLookbookStyle.trim() === ''))) {
                throw new Error("Por favor, escolha um estilo de moda ou envie uma imagem de referência!");
            }
            if (generationMode === 'hairStyler' && !haircutImage && (selectedHairStyles.length === 0 && (!isCustomHairActive || customHairStyle.trim() === ''))) {
                throw new Error("Por favor, selecione um penteado ou envie uma imagem de referência!");
            }
    
            const modelInstruction = getModelInstruction(generationMode, prompt, {
                headshotExpression, headshotPose, currentAlbumStyle,
                lookbookStyle, customLookbookStyle, clothingImage,
                hairColors, haircutImage, mainPrompt,
                figurineBoxTitle, figurineAccessoryImage,
                cameraAngle, cameraLens, lightingStyle, compositionStyle, subjectPose, facialExpression, backgroundOption, backgroundDescription,
                uploadedImage,
                proportion: imageToRegenerate.proportion,
                perspective, customAngle, perspectiveDescription
            });
            
            const parts = [
                { text: modelInstruction }
            ];

            if (uploadedImage) {
                 parts.push({ inlineData: { mimeType: "image/png", data: uploadedImage } });
            }

            if (generationMode === 'styleLookbook' && clothingImage) {
                parts.push({ inlineData: { mimeType: "image/png", data: clothingImage } });
            }
            if (generationMode === 'hairStyler' && haircutImage) {
                parts.push({ inlineData: { mimeType: "image/png", data: haircutImage } });
            }
            if (generationMode === 'figurines' && figurineAccessoryImage) {
                parts.push({ inlineData: { mimeType: "image/png", data: figurineAccessoryImage } });
            }

            const payload = { contents: [{ parts }] };
    
            const imageUrl = await generateImageWithRetry(payload, GEMINI_API_KEY);
    
            setGeneratedImages(prev => prev.map((img, index) => {
                if (index === imageIndex) {
                    const updatedImg = { ...img, status: 'success', imageUrl };
                    // Adicionar ao histórico automaticamente
                    addImageToHistory({
                        imageUrl,
                        template: img.template,
                        prompt: img.prompt || prompt.base,
                        era: img.id,
                        proportion: img.proportion
                    });
                    return updatedImg;
                }
                return img;
            }));
    
        } catch (err) {
            console.error(`A nova geração falhou para ${prompt.id}:`, err);
            setError(`Oops! A nova geração para "${prompt.id}" falhou. ${err.message}`);
            setGeneratedImages(prev => prev.map((img, index) =>
                index === imageIndex ? { ...img, status: 'failed' } : img
            ));
        }
    };
    
    const createUploadHandler = (setIsLoading, setImage) => async (file) => {
        setIsLoading(true);
        setError(null);
        try {
            const dataUrl = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });
            const base64Image = await compressImageToBase64(dataUrl);
            setImage(base64Image);
        } catch (err) {
            console.error("Erro no envio da imagem de referência:", err);
            setError("Essa imagem não pôde ser processada. Tente outro arquivo.");
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleClothingImageUpload = createUploadHandler(setIsUploadingClothing, setClothingImage);
    const handleHaircutImageUpload = createUploadHandler(setIsUploadingHaircut, setHaircutImage);
    const handleAccessoryImageUpload = createUploadHandler(setIsUploadingAccessory, setFigurineAccessoryImage);
    const handleDirectClothingImageUpload = createUploadHandler(setIsUploadingDirectClothing, setDirectClothingImage);



    const handleImageUpload = async (file) => {
        if (file) {
            setIsUploading(true);
            setError(null);
            try {
                const dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
                const base64Image = await compressImageToBase64(dataUrl);
                setUploadedImage(base64Image);
                setGeneratedImages([]); 
            } catch (err) {
                console.error("Erro durante o envio da imagem:", err);
                setError("Essa imagem não pôde ser processada. Por favor, tente outro arquivo.");
            } finally {
                setIsUploading(false);
            }
        }
    };
    
    const handleCaptureConfirm = async (imageDataUrl) => {
        try {
            const base64Image = await compressImageToBase64(imageDataUrl);
            setUploadedImage(base64Image);
            setGeneratedImages([]);
            setError(null);
        } catch (err) {
            setError("Não foi possível processar a imagem da câmera.");
        }
    };
    
    const handleEditRequest = (index) => {
        const image = generatedImages[index];
        if (image && image.status === 'success') {
            setEditingImage({
                index,
                imageUrl: image.imageUrl,
                id: image.id
            });
        }
    };

    const handleApplyEdit = async (index, newPrompt) => {
        const imageToEdit = generatedImages[index];
        if (!imageToEdit) return;

        setEditingImage(null);
        setGeneratedImages(prev => prev.map((img, i) =>
            i === index ? { ...img, status: 'pending' } : img
        ));
        setError(null);

        try {
            const base64Data = imageToEdit.imageUrl.split(',')[1];
            const instruction = `Esta é uma tarefa de edição de imagem. Use a imagem fornecida como ponto de partida. Aplique a seguinte edição descrita pelo usuário: "${newPrompt}". Mantenha o assunto principal e a composição da imagem original, a menos que o prompt peça explicitamente para alterá-la.`;
            
            const parts = [
                { text: instruction },
                { inlineData: { mimeType: "image/png", data: base64Data } }
            ];

            const payload = { contents: [{ parts }] };
            const newImageUrl = await generateImageWithRetry(payload, GEMINI_API_KEY);

            setGeneratedImages(prev => prev.map((img, i) =>
                i === index ? { 
                    ...img, 
                    status: 'success', 
                    imageUrl: newImageUrl, 
                    prompt: newPrompt,
                    id: newPrompt.slice(0, 20) + '...'
                } : img
            ));
        } catch (err) {
            console.error(`A edição falhou para o índice ${index}:`, err);
            setError(`Oops! A edição falhou. ${err.message}`);
            setGeneratedImages(prev => prev.map((img, i) =>
                i === index ? { ...imageToEdit, status: 'failed' } : img
            ));
        }
    };
    
    const handleDeleteImage = (indexToDelete) => {
        setGeneratedImages(prev => prev.filter((_, index) => index !== indexToDelete));
    };

    const handleSaveToHistory = (index) => {
        const image = generatedImages[index];
        if (image && image.status === 'success') {
            addImageToHistory({
                imageUrl: image.imageUrl,
                template: image.template,
                prompt: image.prompt || mainPrompt,
                era: image.id,
                proportion: image.proportion
            });
        }
    };

    const handleEnhancePrompt = async (promptToEnhance) => {
        if (!promptToEnhance.trim()) return null;
    
        const systemPrompt = "Você é um engenheiro de prompts de IA especializado em geração de imagens. Sua tarefa é pegar a ideia simples do usuário e expandi-la para um prompt detalhado e vívido em português. Adicione detalhes sobre o estilo de arte (ex: fotorrealista, pintura a óleo, cartoon, 3D), iluminação (ex: luz dramática, hora dourada, neon), composição (ex: close-up, grande angular, vista de cima), e detalhes ricos de cena para criar uma imagem visualmente impressionante. Responda apenas com o prompt melhorado, sem qualquer outro texto, introdução ou explicação.";
        const payload = {
            contents: [{ parts: [{ text: promptToEnhance }] }],
            systemInstruction: { parts: [{ text: systemPrompt }] },
        };

        try {
            const result = await fetchWithRetry('/api/gemini', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'gemini-2.5-flash-preview-05-20',
                    payload
                })
            });
            const enhancedText = result.candidates?.[0]?.content?.parts?.[0]?.text;
            if (enhancedText) {
                return enhancedText;
            }
            throw new Error("A API não retornou um prompt melhorado.");
        } catch (err) {
            console.error("Falha ao melhorar o prompt:", err);
            setError(`Não foi possível melhorar a descrição. ${err.message}`);
            return null;
        }
    };

    const handleMainPromptEnhance = async () => {
        setIsEnhancingPrompt(true);
        const enhanced = await handleEnhancePrompt(mainPrompt);
        if (enhanced) setMainPrompt(enhanced);
        setIsEnhancingPrompt(false);
    };

    const handlePerspectivePromptEnhance = async () => {
        setIsEnhancingPerspective(true);
        const enhanced = await handleEnhancePrompt(perspectiveDescription);
        if (enhanced) setPerspectiveDescription(enhanced);
        setIsEnhancingPerspective(false);
    };

    // --- CHAT LOGIC ---
    const handleChatSubmit = async () => {
        const userMessage = chatInput.trim();
        if (!userMessage) return;

        const newChatHistory = [...chatHistory, { role: 'user', text: userMessage }];
        setChatHistory(newChatHistory);
        setChatInput('');
        setIsChatLoading(true);

        try {
            // Prepare contents for API call
            const apiContents = newChatHistory.map(msg => ({
                role: msg.role === 'user' ? 'user' : 'model',
                // Se for um prompt final, apenas envie a parte do prompt, não o balão inteiro
                parts: [{ text: msg.text }]
            }));
            
            // Omitir o último item (mensagem do usuário) se for muito longo, para que a IA possa processar
            // Não, vamos apenas enviar a lista completa, pois o sistema de instrução deve ser suficiente.
            
            // Adiciona a instrução do sistema ao payload
            const payload = {
                contents: apiContents,
                systemInstruction: { parts: [{ text: CHAT_SYSTEM_PROMPT }] }
            };

            const result = await fetchWithRetry('/api/gemini', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'gemini-2.5-flash-preview-05-20',
                    payload
                })
            });

            const aiText = result.candidates?.[0]?.content?.parts?.[0]?.text;

            if (aiText) {
                setChatHistory(prev => [...prev, { role: 'model', text: aiText }]);
            } else {
                // Se não houver texto, isso indica uma falha ou resposta inesperada
                console.error("Resposta da API Gemini vazia ou inesperada:", result);
                setChatHistory(prev => [...prev, { role: 'model', text: "Desculpe, o Assistente de Prompts não conseguiu gerar uma resposta. Isso pode ser um problema de conexão. Tente reformular a sua ideia." }]);
            }

        } catch (err) {
            console.error("Falha no chat com a IA:", err);
            setChatHistory(prev => [...prev, { role: 'model', text: "Erro de conexão com o Assistente de Prompts. Por favor, tente novamente mais tarde." }]);
        } finally {
            setIsChatLoading(false);
        }
    };
    // --- END CHAT LOGIC ---

    const handleGenerateClick = async () => {
        // Reset de estados que podem estar travados
        setIsSettingUp(false);
        setError(null);
        
        if (uploadedImage && directClothingImage) {
            setIsLoading(true);
            setError(null);
            setGeneratedImages([]);
            
            setTimeout(() => {
                resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 100);

            const placeholder = {
                id: 'Troca de Roupa',
                status: 'pending',
                imageUrl: null,
                template: 'directSwap',
                proportion: proportion
            };
            setGeneratedImages([placeholder]);

            try {
                const modelInstruction = `A prioridade máxima e absoluta é manter com 100% de exatidão a pessoa, o rosto, o cabelo, o corpo e a pose da primeira foto de referência (o modelo). A sua única tarefa é vestir a pessoa da primeira foto com a roupa da segunda foto. NÃO altere o modelo (rosto, cabelo, corpo, etc.) da primeira foto de forma alguma. A segunda foto é *apenas* uma referência para a roupa. Adapte a roupa de forma realista ao corpo e à pose do modelo. O fundo da foto original deve ser mantido ou apenas ligeiramente ajustado para corresponder à iluminação da nova roupa, se necessário.`;

                const parts = [
                    { text: modelInstruction },
                    { inlineData: { mimeType: "image/png", data: uploadedImage } }, 
                    { inlineData: { mimeType: "image/png", data: directClothingImage } } 
                ];
                
                const payload = { contents: [{ parts }] };
                const imageUrl = await generateImageWithRetry(payload, GEMINI_API_KEY);

                const successImage = { ...placeholder, status: 'success', imageUrl };
                setGeneratedImages([successImage]);
                
                // Adicionar ao histórico automaticamente
                addImageToHistory({
                    imageUrl,
                    template: placeholder.template,
                    prompt: placeholder.prompt || 'Troca de Roupa',
                    era: placeholder.id,
                    proportion: placeholder.proportion
                });
            } catch (err) {
                 console.error(`Falha na troca de roupa:`, err);
                 setGeneratedImages([{ ...placeholder, status: 'failed' }]);
                 setError(`Oops! A troca de roupa falhou. ${err.message}`);
            } finally {
                setIsLoading(false);
            }
            return; 
        }

        // Bloco de Validação
        if (!proportion) {
            setError("Por favor, selecione uma proporção para a imagem!");
            return;
        }

        // Temas que EXIGEM foto
        const themesRequiringPhoto = ['styleLookbook', 'hairStyler', 'figurines', 'headshots', 'directSwap'];
        
        if (!uploadedImage && mainPrompt.trim() === '' && !template) {
            setError("Por favor, envie uma foto, descreva uma imagem ou escolha um tema!");
            return;
        }

        if (template && !uploadedImage && themesRequiringPhoto.includes(template)) {
            setError(`Para usar o tema "${templates[template]?.name || template}", você precisa enviar uma foto.`);
            return;
        }
        
        if (uploadedImage && !template && mainPrompt.trim() === '' && !directClothingImage) {
            setError("Você enviou uma foto. Agora, descreva sua ideia, envie uma roupa ou escolha um tema!");
            return;
        }

        if (template === 'styleLookbook' && !clothingImage && (lookbookStyle === '' || (lookbookStyle === 'Outro' && customLookbookStyle.trim() === ''))) {
            setError("Por favor, escolha um estilo de moda ou envie uma imagem de referência!");
            return;
        }
        if (template === 'hairStyler' && !haircutImage && (selectedHairStyles.length === 0 && (!isCustomHairActive || customHairStyle.trim() === ''))) {
            setError("Por favor, selecione um penteado ou envie uma imagem de referência!");
            return;
        }
        if (template === 'hairStyler' && isCustomHairActive && customHairStyle.trim() === '') {
            setError("Por favor, insira seu estilo de cabelo personalizado ou desmarque 'Outro...'");
            return;
        }

        setIsLoading(true);
        setError(null);
        setGeneratedImages([]);
        
        setTimeout(() => {
            resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);

        const generationMode = template || 'promptBased';
        const activeTemplate = templates[generationMode];

        let dynamicStyleForAlbum = '';
        if (generationMode === 'eightiesMall') {
            setIsSettingUp(true);
            try {
                dynamicStyleForAlbum = await generateDynamicPrompt("Um estilo específico, criativo e detalhado para uma sessão de fotos de estúdio em um shopping dos anos 80.");
                setCurrentAlbumStyle(dynamicStyleForAlbum);
            } catch(e) {
                setError(`Não conseguimos gerar um estilo para a sessão de fotos. ${e.message}`);
                setIsLoading(false);
                setIsSettingUp(false);
                return;
            }
            setIsSettingUp(false);
        } else {
            setCurrentAlbumStyle(''); 
        }

        let promptsForGeneration;
        if (generationMode === 'promptBased') {
            promptsForGeneration = [{ id: mainPrompt, base: mainPrompt }];
        } else if (['personalizar', 'figurinha', 'editorialTechRetro', 'mysteriousEditorial', 'architectStyle', 'spotlightPortrait', 'cinematicStreetStyle', 'shadowPortrait', 'viceCityStyle', 'urbanNeon', 'bwProfile', 'projectedSilhouette', 'popMagazineCover'].includes(generationMode)) {
            promptsForGeneration = activeTemplate.prompts;
        } else if (generationMode === 'hairStyler' && haircutImage) {
            promptsForGeneration = [{ id: 'Corte da Referência', base: '' }];
        } else if (generationMode === 'styleLookbook' && clothingImage) {
            promptsForGeneration = activeTemplate.prompts.slice(0, 2);
        } else if (generationMode === 'hairStyler') {
            const selectedPrompts = activeTemplate.prompts.filter(p => selectedHairStyles.includes(p.id));
            if (isCustomHairActive && customHairStyle.trim() !== '') {
                selectedPrompts.push({ id: customHairStyle, base: customHairStyle });
            }
            promptsForGeneration = selectedPrompts;
        } else {
            promptsForGeneration = activeTemplate.prompts;
        }
        
        const singleImageTemplates = ['personalizar', 'promptBased', 'figurinha', 'editorialTechRetro', 'mysteriousEditorial', 'architectStyle', 'spotlightPortrait', 'cinematicStreetStyle', 'shadowPortrait', 'viceCityStyle', 'urbanNeon', 'bwProfile', 'projectedSilhouette', 'popMagazineCover'];
        const isSingleImageTemplate = singleImageTemplates.includes(generationMode);
        const finalNumImages = isSingleImageTemplate ? promptsForGeneration.length : numImages;

        const finalPrompts = promptsForGeneration.slice(0, finalNumImages);

        if (!finalPrompts || finalPrompts.length === 0) {
            setError("Houve um problema ao preparar as ideias criativas. Por favor, tente novamente.");
            setIsLoading(false);
            return;
        }

        const initialPlaceholders = finalPrompts.map(p => ({
            id: p.id,
            status: 'pending',
            imageUrl: null,
            template: generationMode,
            prompt: p.base,
            proportion: proportion
        }));
        setGeneratedImages(initialPlaceholders);

        for (let i = 0; i < finalPrompts.length; i++) {
            const p = finalPrompts[i];
            try {
                const modelInstruction = getModelInstruction(generationMode, p, {
                    headshotExpression, headshotPose,
                    currentAlbumStyle: dynamicStyleForAlbum,
                    lookbookStyle, customLookbookStyle, clothingImage,
                    hairColors, haircutImage, mainPrompt,
                    figurineBoxTitle, figurineAccessoryImage,
                    cameraAngle, cameraLens, lightingStyle, compositionStyle, subjectPose, facialExpression, backgroundOption, backgroundDescription,
                    uploadedImage,
                    proportion,
                    perspective, customAngle, perspectiveDescription
                });
                
                const parts = [
                    { text: modelInstruction }
                ];
                
                if (uploadedImage) {
                    parts.push({ inlineData: { mimeType: "image/png", data: uploadedImage } });
                }
                
                if (generationMode === 'styleLookbook' && clothingImage) {
                    parts.push({ inlineData: { mimeType: "image/png", data: clothingImage } });
                }
                if (generationMode === 'hairStyler' && haircutImage) {
                    parts.push({ inlineData: { mimeType: "image/png", data: haircutImage } });
                }
                if (generationMode === 'figurines' && figurineAccessoryImage) {
                    parts.push({ inlineData: { mimeType: "image/png", data: figurineAccessoryImage } });
                }

                const payload = { contents: [{ parts }] };

                const imageUrl = await generateImageWithRetry(payload, GEMINI_API_KEY);

                setGeneratedImages(prev => prev.map((img, index) => {
                    if (index === i) {
                        const updatedImg = { ...img, status: 'success', imageUrl };
                        // Adicionar ao histórico automaticamente
                        addImageToHistory({
                            imageUrl,
                            template: img.template,
                            prompt: img.prompt || p.base,
                            era: img.id,
                            proportion: img.proportion
                        });
                        return updatedImg;
                    }
                    return img;
                }));

            } catch (err) {
                console.error(`Falha ao gerar imagem para ${p.id} após todas as tentativas:`, err);
                
                // Verificar se é erro de cota excedida
                if (err.message.includes('Cota da API excedida') || err.message.includes('quota') || err.message.includes('Quota exceeded')) {
                    setError("🚫 Cota da API excedida! Você atingiu o limite gratuito do Google Gemini. Aguarde algumas horas ou considere fazer upgrade do seu plano para continuar gerando imagens.");
                }
                
                setGeneratedImages(prev => prev.map((img, index) =>
                    index === i ? { ...img, status: 'failed' } : img
                ));
            }
        }

        setIsLoading(false);
    };

    const triggerDownload = async (href, fileName) => {
        try {
            console.log("=== INICIANDO DOWNLOAD ===");
            console.log("Arquivo:", fileName);
            console.log("URL:", href.substring(0, 100));
            
            // Verificar se está rodando em um ambiente nativo (Android/iOS)
            const isNative = Capacitor.isNativePlatform();
            const platform = Capacitor.getPlatform();
            console.log("Plataforma:", platform);
            console.log("É nativo?", isNative);
            
            if (isNative) {
                console.log(">>> MODO ANDROID/iOS NATIVO <<<");
                
                try {
                    // Verificar se o plugin Filesystem está disponível
                    if (!Filesystem || !Filesystem.writeFile) {
                        throw new Error("Plugin Filesystem não está disponível");
                    }
                    console.log("✓ Plugin Filesystem disponível");
                    
                    // Solicitar permissões primeiro (Android 6+)
                    try {
                        const permissions = await Filesystem.checkPermissions();
                        console.log("Permissões atuais:", permissions);
                        
                        if (permissions.publicStorage !== 'granted') {
                            console.log("Solicitando permissões...");
                            const requestResult = await Filesystem.requestPermissions();
                            console.log("Resultado da solicitação:", requestResult);
                            
                            if (requestResult.publicStorage !== 'granted') {
                                alert('⚠️ Permissão negada!\n\nPara salvar imagens, você precisa permitir o acesso ao armazenamento nas configurações do app.');
                                return;
                            }
                        }
                        console.log("✓ Permissões OK");
                    } catch (permError) {
                        console.warn("Aviso ao verificar permissões:", permError);
                        // Continuar mesmo com erro de permissão
                    }
                    
                    // Converter a imagem para base64 se não estiver
                    let base64Data = href;
                    if (!href.startsWith('data:')) {
                        console.log("Convertendo URL para base64...");
                        const response = await fetch(href);
                        if (!response.ok) {
                            throw new Error(`Falha ao buscar imagem: ${response.status}`);
                        }
                        const blob = await response.blob();
                        console.log("Blob obtido, tamanho:", blob.size);
                        base64Data = await new Promise((resolve, reject) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.onerror = reject;
                            reader.readAsDataURL(blob);
                        });
                        console.log("✓ Conversão para base64 concluída");
                    }
                    
                    // Remover o prefixo data:image/png;base64, se existir
                    const base64Content = base64Data.split(',')[1] || base64Data;
                    console.log("Tamanho do base64:", base64Content.length);
                    
                    // Gerar nome de arquivo único com timestamp
                    const timestamp = new Date().getTime();
                    const uniqueFileName = `PocketStudio_${timestamp}_${fileName}`;
                    console.log("Nome do arquivo:", uniqueFileName);
                    
                    // Tentar salvar no diretório externo primeiro (visível na galeria)
                    console.log("Tentando salvar no armazenamento externo...");
                    try {
                        const result = await Filesystem.writeFile({
                            path: `PocketStudio/${uniqueFileName}`,
                            data: base64Content,
                            directory: Directory.ExternalStorage,
                            recursive: true
                        });
                        
                        console.log("✅ SUCESSO! Arquivo salvo em:", result.uri);
                        alert(`✅ Imagem salva com sucesso!\n\n📁 Local: Armazenamento/PocketStudio/\n📄 Arquivo: ${uniqueFileName}\n\n💡 Você pode encontrar a imagem na galeria ou no gerenciador de arquivos.`);
                        return;
                    } catch (externalError) {
                        console.warn("Não foi possível salvar no armazenamento externo:", externalError);
                        console.log("Tentando salvar em Documents...");
                        
                        // Fallback para Documents
                        const result = await Filesystem.writeFile({
                            path: uniqueFileName,
                            data: base64Content,
                            directory: Directory.Documents,
                            recursive: true
                        });
                        
                        console.log("✅ Arquivo salvo em Documents:", result.uri);
                        alert(`✅ Imagem salva!\n\n📁 Local: Documentos do App\n📄 Arquivo: ${uniqueFileName}\n\n💡 Acesse através do gerenciador de arquivos.`);
                        return;
                    }
                    
                } catch (nativeError) {
                    console.error("❌ ERRO NO MODO NATIVO:", nativeError);
                    alert(`❌ Erro ao salvar imagem:\n\n${nativeError.message}\n\nTente novamente ou entre em contato com o suporte.`);
                    throw nativeError;
                }
            }
            
            // Para navegadores web (não nativo)
            console.log("Usando método de download para navegador web");
            
            // Se for um data URL, fazer download direto
            if (href.startsWith('data:')) {
                const link = document.createElement('a');
                link.href = href;
                link.download = fileName;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                console.log("Download concluído (data URL)");
                return;
            }
            
            // Para URLs remotas, tentar fazer fetch
            const response = await fetch(href, { mode: 'cors' });
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = fileName;
            document.body.appendChild(link);
            link.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(link);
            console.log("Download concluído (remote URL)");
        } catch (error) {
            console.error("Não foi possível baixar a imagem:", error);
            // Tentar método alternativo
            try {
                console.log("Tentando método alternativo de download...");
                const link = document.createElement('a');
                link.href = href;
                link.download = fileName;
                link.target = '_blank';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                console.log("Download iniciado com método alternativo");
            } catch (altError) {
                console.error("Método alternativo também falhou:", altError);
                setError(`Desculpe, o download falhou. Erro: ${error.message}`);
            }
        }
    };

    const handleDownloadRequest = async (imageUrl, era, ratio) => {
        console.log("handleDownloadRequest chamado:", { imageUrl, era, ratio });
        // Converter era para string se for número
        const eraString = String(era);
        const fileName = `pocket-studio-${eraString.toLowerCase().replace(/\s+/g, '-')}-${ratio.replace(':', 'x')}.png`;
        try {
            const croppedImageUrl = await cropImage(imageUrl, ratio);
            console.log("Imagem cortada com sucesso");
            await triggerDownload(croppedImageUrl, fileName);
        } catch (err) {
            console.error(`Falha ao cortar imagem para download:`, err);
            // Se o crop falhar, tentar baixar a imagem original
            console.log("Tentando baixar imagem original sem cortar...");
            try {
                await triggerDownload(imageUrl, `pocket-studio-${eraString.toLowerCase().replace(/\s+/g, '-')}-original.png`);
            } catch (downloadErr) {
                console.error("Falha ao baixar imagem original:", downloadErr);
                setError(`Não foi possível baixar a imagem. Por favor, clique com o botão direito na imagem e selecione "Salvar imagem como..."`);
            }
        }
    };


    const handleAlbumDownloadRequest = async (ratio) => {
        if (isDownloadingAlbum) return;
        setIsDownloadingAlbum(true);
        setError(null);

        try {
            const successfulImages = generatedImages.filter(img => img.status === 'success' && img.template !== 'figurinha');
            if (successfulImages.length === 0) {
                setError("Não há imagens bem-sucedidas para incluir em um álbum.");
                setIsDownloadingAlbum(false);
                return;
            }

            const croppedImageUrls = await Promise.all(
                successfulImages.map(img => cropImage(img.imageUrl, ratio))
            );

            const imagesToStitch = await Promise.all(
                croppedImageUrls.map(url => new Promise((resolve, reject) => {
                    const img = new Image();
                    img.crossOrigin = "anonymous";
                    img.src = url;
                    img.onload = () => resolve(img);
                    img.onerror = reject;
                }))
            );

            if (imagesToStitch.length === 0) throw new Error("Nenhuma imagem para criar um álbum.");

            // Cria a Grade de Imagens Costuradas
            const stitchCanvas = document.createElement('canvas');
            const stitchCtx = stitchCanvas.getContext('2d');

            const cols = imagesToStitch.length > 4 ? 3 : (imagesToStitch.length > 1 ? 2 : 1);
            const rows = Math.ceil(imagesToStitch.length / cols);
            const imageWidth = imagesToStitch[0].width;
            const imageHeight = imagesToStitch[0].height;
            const padding = Math.floor(imageWidth * 0.02); // Um pequeno preenchimento

            stitchCanvas.width = (cols * imageWidth) + ((cols - 1) * padding);
            stitchCanvas.height = (rows * imageHeight) + ((rows - 1) * padding);

            imagesToStitch.forEach((img, index) => {
                const row = Math.floor(index / cols);
                const col = index % cols;
                stitchCtx.drawImage(img, col * (imageWidth + padding), row * (imageHeight + padding), imageWidth, imageHeight);
            });
            
            await triggerDownload(stitchCanvas.toDataURL('image/png'), `alterart-ia-album-${ratio.replace(':', 'x')}.png`);
        } catch (err) {
            console.error("Falha ao criar ou baixar o álbum:", err);
            setError(`Desculpe, o download do álbum falhou. ${err.message}`);
        } finally {
            setIsDownloadingAlbum(false);
        }
    };
    
    const handleShare = async (imageUrl, era) => {
        try {
            console.log("=== INICIANDO COMPARTILHAMENTO ===");
            console.log("URL da imagem:", imageUrl.substring(0, 100));
            console.log("Nome:", era);
            
            const isNative = Capacitor.isNativePlatform();
            console.log("Plataforma nativa?", isNative);
            
            if (isNative) {
                // Usar plugin Share do Capacitor no Android/iOS
                console.log(">>> USANDO SHARE NATIVO <<<");
                
                try {
                    // Verificar se o plugin está disponível
                    if (!Share || !Share.share) {
                        throw new Error("Plugin Share não está disponível");
                    }
                    
                    console.log("✓ Plugin Share disponível");
                    
                    // Para compartilhar imagens no Android, precisamos salvar primeiro
                    // e depois compartilhar o caminho do arquivo
                    console.log("Convertendo imagem para base64...");
                    
                    let base64Data = imageUrl;
                    if (!imageUrl.startsWith('data:')) {
                        const response = await fetch(imageUrl);
                        const blob = await response.blob();
                        base64Data = await new Promise((resolve) => {
                            const reader = new FileReader();
                            reader.onloadend = () => resolve(reader.result);
                            reader.readAsDataURL(blob);
                        });
                    }
                    
                    const base64Content = base64Data.split(',')[1] || base64Data;
                    const eraString = String(era);
                    const fileName = `pocket-studio-${eraString.toLowerCase().replace(/\s+/g, '-')}.png`;
                    
                    console.log("Salvando imagem temporariamente...");
                    
                    // Salvar temporariamente para compartilhar
                    const result = await Filesystem.writeFile({
                        path: `share/${fileName}`,
                        data: base64Content,
                        directory: Directory.Cache,
                        recursive: true
                    });
                    
                    console.log("Arquivo salvo em:", result.uri);
                    
                    // Compartilhar usando o plugin
                    await Share.share({
                        title: 'Imagem Gerada por PocketStudio',
                        text: `Veja a imagem "${era}" que criei com o PocketStudio!`,
                        url: result.uri,
                        dialogTitle: 'Compartilhar Imagem'
                    });
                    
                    console.log("✅ Compartilhamento concluído!");
                    
                } catch (shareError) {
                    console.error("❌ Erro no compartilhamento nativo:", shareError);
                    
                    // Fallback: tentar compartilhar só texto com link (se houver)
                    try {
                        await Share.share({
                            title: 'PocketStudio',
                            text: `Criei esta imagem "${era}" com o PocketStudio!`,
                            dialogTitle: 'Compartilhar'
                        });
                    } catch (fallbackError) {
                        console.error("Fallback também falhou:", fallbackError);
                        setError(`Não foi possível compartilhar: ${shareError.message}`);
                    }
                }
                
                return;
            }
            
            // Modo navegador web - usar Web Share API
            console.log(">>> USANDO WEB SHARE API <<<");
            
            if (!navigator.share) {
                setError("O compartilhamento não é suportado neste navegador.");
                return;
            }
            
            console.log("Preparando arquivo para compartilhar...");
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            const file = new File([blob], `pocket-studio-${era}.png`, { type: blob.type });

            console.log("Compartilhando via Web Share API...");
            await navigator.share({
                title: `Imagem Gerada por PocketStudio`,
                text: `Veja a imagem "${era}" que criei com a aplicação PocketStudio!`,
                files: [file],
            });
            
            console.log("✅ Compartilhamento concluído!");
            
        } catch (error) {
            console.error('❌ Erro ao partilhar:', error);
            if (error.name === 'AbortError') {
                console.log("Usuário cancelou o compartilhamento");
                // Não mostrar erro se o usuário cancelou
            } else {
                setError(`Não foi possível compartilhar a imagem. ${error.message}`);
            }
        }
    };

    const handleTemplateSelect = (templateId) => {
        const singleImageTemplates = ['personalizar', 'figurinha', 'spotlightPortrait', 'cinematicStreetStyle', 'shadowPortrait', 'viceCityStyle', 'urbanNeon', 'bwProfile', 'projectedSilhouette', 'popMagazineCover', 'editorialTechRetro', 'mysteriousEditorial', 'architectStyle'];

        if (template === templateId) {
            setTemplate(null); // Deselect if clicking the same one
        } else {
            setTemplate(templateId);
            const isSingleImageTemplate = singleImageTemplates.includes(templateId);
            setNumImages(isSingleImageTemplate ? 1 : 4);
            // Reseta todos os outros estados de tema
            setHeadshotExpression('Sorriso Amigável');
            setHeadshotPose('Frente');
            setLookbookStyle('');
            setCustomLookbookStyle('');
            setClothingImage(null);
            setHairColors([]);
            setSelectedHairStyles([]);
            setCustomHairStyle('');
            setIsCustomHairActive(false);
            setHaircutImage(null);
            setFigurineBoxTitle('');
            setFigurineAccessoryImage(null);
            setCameraAngle('Nível dos Olhos');
            setCameraLens('Padrão (50mm)');
            setLightingStyle('Natural');
            setCompositionStyle('Como na foto original');
            setSubjectPose('Como na foto original');
            setFacialExpression('Como na foto original');
            setBackgroundOption('manter');
            setBackgroundDescription('');
        }
    };

    const handleStartOver = (keepImage = false) => {
        setGeneratedImages([]);
        if (!keepImage) {
            setUploadedImage(null);
        }
        setError(null);
        setTemplate(null);
        setDirectClothingImage(null);
        setPerspective('normal');
        setCustomAngle('frontal');
        setPerspectiveDescription('');
        // Reseta todos os outros estados de tema
        handleTemplateSelect(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    

    const AlbumDownloadButton = () => {
        const [isOpen, setIsOpen] = useState(false);
        const menuRef = useRef(null);

        useEffect(() => {
            const handleClickOutside = (event) => {
                if (menuRef.current && !menuRef.current.contains(event.target)) {
                    setIsOpen(false);
                }
            };
            document.addEventListener("mousedown", handleClickOutside);
            return () => {
                document.removeEventListener("mousedown", handleClickOutside);
            };
        }, [menuRef]);
        
        const handleButtonClick = () => {
            setIsOpen(!isOpen);
        };

        return (
             <div className="relative" ref={menuRef}>
                <Button primary disabled={isDownloadingAlbum} onClick={handleButtonClick}>
                    {isDownloadingAlbum ? (
                        <div className="flex items-center justify-center gap-2">
                            <div className="animate-spin rounded-full h-4 w-4 border-t-2 border-b-2 border-black"></div>
                            <span>Preparando...</span>
                        </div>
                    ) : (
                         <div className="flex items-center gap-2">
                            <IconDownload />
                            <span>Baixar Álbum</span>
                        </div>
                    )}
                </Button>
                {isOpen && !isDownloadingAlbum && (
                    <motion.div
                        initial={{ opacity: 0, scale: 0.95, y: 10 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        transition={{ duration: 0.1 }}
                        className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-20"
                    >
                       <div className="bg-black/80 backdrop-blur-lg rounded-xl text-white text-sm flex flex-col items-start p-1 shadow-2xl w-48 border border-gray-700">
                           <button onClick={() => { handleAlbumDownloadRequest('1:1'); setIsOpen(false); }} className="w-full text-left px-4 py-2 hover:bg-yellow-400/20 rounded-lg transition-colors">Quadrado (1:1)</button>
                           <button onClick={() => { handleAlbumDownloadRequest('9:16'); setIsOpen(false); }} className="w-full text-left px-4 py-2 hover:bg-yellow-400/20 rounded-lg transition-colors">Retrato (9:16)</button>
                           <button onClick={() => { handleAlbumDownloadRequest('16:9'); setIsOpen(false); }} className="w-full text-left px-4 py-2 hover:bg-yellow-400/20 rounded-lg transition-colors">Horizontal (16:9)</button>
                           <button onClick={() => { handleAlbumDownloadRequest('2:7'); setIsOpen(false); }} className="w-full text-left px-4 py-2 hover:bg-yellow-400/20 rounded-lg transition-colors">Marcador de Página (2:7)</button>
                       </div>
                    </motion.div>
                )}
            </div>
        );
    };

    const progress = generatedImages.length > 0
        ? (generatedImages.filter(img => img.status !== 'pending').length / generatedImages.length) * 100
        : 0;

    const totalSelectedStyles = selectedHairStyles.length + (isCustomHairActive ? 1 : 0);

    const buttonText = uploadedImage && directClothingImage ? "Trocar Roupa" : "Gerar Fotos";
    
    // Temas que EXIGEM foto
    const themesRequiringImage = ['styleLookbook', 'hairStyler', 'figurines', 'headshots', 'directSwap'];
    const selectedThemeRequiresImage = template && themesRequiringImage.includes(template);
    
    // Pode gerar apenas com prompt (sem foto, sem tema que exija foto)
    const canGenerateWithPromptOnly = !uploadedImage && mainPrompt.trim() !== '' && !!proportion && !selectedThemeRequiresImage;
    
    // Pode gerar com tema que não exige foto
    const canGenerateWithThemeOnly = !uploadedImage && template && !selectedThemeRequiresImage && !!proportion;
    
    // Pode gerar com foto
    const canGenerateWithImage = uploadedImage && (template || mainPrompt.trim() !== '' || directClothingImage) && !!proportion;
    
    const isReadyToGenerate = canGenerateWithPromptOnly || canGenerateWithThemeOnly || canGenerateWithImage;
    const isGenerateButtonDisabled = isLoading || isUploading || isUploadingDirectClothing || isSettingUp || !isReadyToGenerate;
    
    
    

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
            handleImageUpload(files[0]);
            e.dataTransfer.clearData();
        }
    };
    
    const angleGrid = [
        'de cima-esquerda', 'de cima', 'de cima-direita',
        'da esquerda', 'frontal', 'da direita',
        'de baixo-esquerda', 'de baixo', 'de baixo-direita'
    ];


    return (
        <>
            <style>{`
              @import url('https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=Inter:wght@400;500;600;700&display=swap');
              
              body { font-family: 'Inter', sans-serif; background-color: #000000; }
              .font-caveat { font-family: 'Caveat', cursive; }
              
              @keyframes fade-in-down {
                0% { opacity: 0; transform: translateY(-20px); }
                100% { opacity: 1; transform: translateY(0); }
              }
              .animate-fade-in-down { animation: fade-in-down 0.5s ease-out forwards; }

               .styled-scrollbar::-webkit-scrollbar { width: 8px; }
               .styled-scrollbar::-webkit-scrollbar-track { background: #334155; border-radius: 10px; }
               .styled-scrollbar::-webkit-scrollbar-thumb { background: #64748B; border-radius: 10px; }
               .styled-scrollbar::-webkit-scrollbar-thumb:hover { background: #FBBF24; }
            `}</style>
            
            <CameraModal
                isOpen={isCameraOpen}
                onClose={() => setIsCameraOpen(false)}
                onCapture={handleCaptureConfirm}
            />
            
            <EditModal 
                image={editingImage}
                onClose={() => setEditingImage(null)}
                onApplyEdit={handleApplyEdit}
                onEnhancePrompt={handleEnhancePrompt}
            />
            
            <HistoryPanel
                isOpen={isHistoryOpen}
                onClose={() => setIsHistoryOpen(false)}
                history={history}
                onClearHistory={handleClearHistory}
                onEdit={handleEditHistoryImage}
                onDelete={handleDeleteHistoryImage}
                onDownload={handleDownloadHistoryImage}
            />
            
            {/* Novo Modal de Chat */}
            <ChatModal
                isOpen={isChatModalOpen}
                onClose={() => setIsChatModalOpen(false)}
                chatHistory={chatHistory}
                chatInput={chatInput}
                setChatInput={setChatInput}
                isLoading={isChatLoading}
                onSend={handleChatSubmit}
            />

            {/* Notificação de Histórico */}
            {historyNotification && (
                <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-50 bg-gray-900 border border-gray-700 text-gray-300 px-4 py-2 rounded-lg shadow-2xl animate-fade-in-down">
                    {historyNotification}
                </div>
            )}
            
            <div className="fixed top-6 right-6 z-30 flex flex-col items-center space-y-4">
                <button onClick={() => setIsHistoryOpen(true)} className="p-3 bg-gray-900/70 backdrop-blur-sm rounded-full text-gray-300 hover:text-white hover:bg-gray-800/80 transition-all shadow-lg border border-gray-700" title="Histórico">
                    <IconHistory />
                </button>
                {/* Novo Ícone de Balão de Mensagem para Chat */}
                <button 
                    onClick={() => setIsChatModalOpen(true)} 
                    className="p-3 bg-yellow-400/80 backdrop-blur-sm rounded-full text-black hover:text-black hover:bg-yellow-400 transition-all shadow-lg border border-yellow-300" 
                    title="Assistente de Prompts"
                >
                    <IconChat />
                </button>
            </div>


            <div className="bg-black text-gray-200 min-h-screen flex flex-col items-center px-2 sm:px-4 pb-20">
                <div className="w-full max-w-6xl mx-auto">
                    
                    <header className="text-center my-6 sm:my-12 px-2">
                        <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-caveat text-white tracking-tight">
                            Pocket<span className="text-yellow-400">Studio</span>
                        </h1>
                        <p className="mt-3 sm:mt-4 text-base sm:text-lg text-gray-500 px-2">O PocketStudio é o estúdio que cabe no seu bolso.</p>
                        <p className="text-sm sm:text-md text-gray-500 mt-2 px-2">Com tecnologia de IA, ele transforma suas fotos simples em retratos dignos de um estúdio profissional — sem precisar de câmeras, luzes ou fundo branco, e sem precisar sair de casa.</p>
                    </header>

                    <main>
                        <div className="bg-gray-900/50 backdrop-blur-sm p-4 sm:p-6 md:p-8 rounded-2xl shadow-2xl border border-gray-800 mb-16">
                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 md:gap-10">

                                <div className="relative">
                                    <h2 className="text-xl sm:text-2xl font-semibold mb-4 sm:mb-6 text-white">1. Sua Foto <span className="text-sm sm:text-base text-gray-500 font-normal">(Opcional)</span></h2>
                                    <div 
                                        className={`w-full aspect-square border-4 border-dashed  rounded-xl flex items-center justify-center transition-colors bg-gray-800 overflow-hidden shadow-inner relative group ${!uploadedImage && 'cursor-pointer hover:border-yellow-400'} ${isDragging ? 'border-yellow-400 ring-4 ring-yellow-400/50' : 'border-gray-700'}`}
                                        onClick={() => !uploadedImage && fileInputRef.current && fileInputRef.current.click()}
                                        onDragOver={handleDragOver}
                                        onDragLeave={handleDragLeave}
                                        onDrop={handleDrop}
                                    >
                                        {isUploading ? (
                                            <div className="flex flex-col items-center">
                                                <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-yellow-400"></div>
                                                <p className="text-gray-400 mt-4">Enviando...</p>
                                            </div>
                                        ) : uploadedImage ? (
                                            <>
                                                <img src={`data:image/png;base64,${uploadedImage}`} alt="Prévia da imagem enviada" className="w-full h-full object-cover" />
                                                <button onClick={() => setUploadedImage(null)} className="absolute top-3 right-3 p-2 rounded-full bg-black/60 text-white hover:bg-black/80 opacity-0 group-hover:opacity-100 transition-opacity" aria-label="Remover foto">
                                                    <IconX />
                                                </button>
                                            </>
                                        ) : (
                                            <div className="flex flex-col items-center justify-center p-6 text-center text-gray-500 pointer-events-none">
                                                <IconUpload />
                                                <p className="mt-4 text-lg text-gray-300">{isDragging ? "Solte a imagem aqui!" : "Arraste e solte ou clique"}</p>
                                                <p className="mt-4 text-sm pointer-events-auto">ou</p>
                                                <Button
                                                    onClick={(e) => {
                                                        e.stopPropagation(); // Impede o diálogo de arquivo
                                                        setIsCameraOpen(true);
                                                    }}
                                                    className="mt-2 pointer-events-auto"
                                                >
                                                    <div className="flex items-center gap-2">
                                                        <IconCamera />
                                                        <span>Usar Câmera</span>
                                                    </div>
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                    {uploadedImage && !isUploading && (
                                        <div className="flex flex-col sm:flex-row gap-4 mt-4 w-full">
                                            <Button onClick={() => fileInputRef.current && fileInputRef.current.click()} className="flex-1">
                                                Trocar Arquivo
                                            </Button>
                                            <Button onClick={() => setIsCameraOpen(true)} className="flex-1">
                                                <div className="flex items-center justify-center gap-2">
                                                    <IconCamera />
                                                    <span>Usar Câmera</span>
                                                </div>
                                            </Button>
                                        </div>
                                    )}
                                     <input type="file" ref={fileInputRef} onChange={(e) => handleImageUpload(e.target.files[0])} accept="image/png, image/jpeg" className="hidden" />
                                </div>

                                <div>
                                     <h2 className="text-xl sm:text-2xl font-semibold mb-4 sm:mb-6 text-white">2. Detalhes da Geração</h2>
                                     
                                     <div>
                                        <label htmlFor="main-prompt" className="block text-lg font-semibold text-gray-300 mb-2">Descreva sua Ideia</label>
                                        <div className="relative">
                                            <textarea
                                                id="main-prompt"
                                                value={mainPrompt}
                                                onChange={(e) => setMainPrompt(e.target.value)}
                                                placeholder="Ex: um astronauta surfando em um anel de Saturno..."
                                                className="w-full bg-gray-800 border border-gray-700 rounded-lg py-3 px-4 focus:outline-none focus:ring-2 focus:ring-yellow-400 text-white transition-colors h-28 resize-none pr-12"
                                            />
                                            <button 
                                                onClick={handleMainPromptEnhance} 
                                                disabled={isEnhancingPrompt || !mainPrompt}
                                                className="absolute bottom-3 right-3 p-2 rounded-full bg-yellow-400/20 text-yellow-300 hover:bg-yellow-400/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                                title="Melhorar Descrição com IA"
                                            >
                                                {isEnhancingPrompt ? (
                                                     <div className="w-5 h-5 animate-spin rounded-full border-2 border-yellow-300 border-t-transparent"></div>
                                                ) : (
                                                     <IconSparkles className="w-5 h-5"/>
                                                )}
                                            </button>
                                         </div>
                                      </div>

                                      <div className="mt-6">
                                        <h3 className="text-lg font-semibold text-gray-300 mb-3">Proporção <span className="text-red-400">*</span></h3>
                                        <div className="flex flex-wrap gap-3">
                                            <RadioPill name="proportion" value="1:1" label="Quadrado (Feed)" checked={proportion === '1:1'} onChange={e => setProportion(e.target.value)} />
                                            <RadioPill name="proportion" value="9:16" label="Retrato (Story)" checked={proportion === '9:16'} onChange={e => setProportion(e.target.value)} />
                                            <RadioPill name="proportion" value="16:9" label="Horizontal (Vídeo)" checked={proportion === '16:9'} onChange={e => setProportion(e.target.value)} />
                                            <RadioPill name="proportion" value="2:7" label="Marcador de Página" checked={proportion === '2:7'} onChange={e => setProportion(e.target.value)} />
                                        </div>
                                      </div>
                                      
                                       <div className="mt-6">
                                            <h3 className="text-lg font-semibold text-gray-300 mb-3">Perspectiva</h3>
                                            <div className="flex flex-wrap gap-3">
                                                <RadioPill name="perspective" value="normal" label="Modo Normal" checked={perspective === 'normal'} onChange={e => setPerspective(e.target.value)} />
                                                <RadioPill name="perspective" value="aerial" label="Visão Aérea (Drone)" checked={perspective === 'aerial'} onChange={e => setPerspective(e.target.value)} />
                                                <RadioPill name="perspective" value="worm" label="Visão de Minhoca" checked={perspective === 'worm'} onChange={e => setPerspective(e.target.value)} />
                                                <RadioPill name="perspective" value="custom" label="Mudar Ângulo" checked={perspective === 'custom'} onChange={e => setPerspective(e.target.value)} />
                                            </div>
                                            <AnimatePresence>
                                            {perspective === 'custom' && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: -10, height: 0 }}
                                                    animate={{ opacity: 1, y: 0, height: 'auto' }}
                                                    exit={{ opacity: 0, y: -10, height: 0 }}
                                                    className="mt-4 bg-gray-800/50 p-4 rounded-lg border border-gray-700"
                                                >
                                                    <div className="grid grid-cols-3 gap-1 w-32 mx-auto md:mx-0">
                                                        {angleGrid.map(angle => (
                                                            <button
                                                                key={angle}
                                                                onClick={() => setCustomAngle(angle)}
                                                                className={`aspect-square flex items-center justify-center rounded-md transition-colors ${customAngle === angle ? 'bg-yellow-400 text-black' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}`}
                                                                title={`Ângulo ${angle.replace('-', ' ')}`}
                                                            >
                                                                <AngleIcon angle={angle} />
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div className="flex-grow mt-4">
                                                         <label htmlFor="perspective-prompt" className="block text-sm font-medium text-gray-400 mb-2">Detalhe a visão (opcional)</label>
                                                        <div className="relative">
                                                            <textarea
                                                                id="perspective-prompt"
                                                                value={perspectiveDescription}
                                                                onChange={(e) => setPerspectiveDescription(e.target.value)}
                                                                placeholder="Ex: Câmera seguindo por trás, close-up no rosto..."
                                                                className="w-full bg-gray-700 border border-gray-600 rounded-lg py-2 px-3 focus:outline-none focus:ring-2 focus:ring-yellow-400 text-white transition-colors h-24 resize-none pr-10"
                                                            />
                                                            <button 
                                                                onClick={handlePerspectivePromptEnhance} 
                                                                disabled={isEnhancingPerspective || !perspectiveDescription}
                                                                className="absolute bottom-2 right-2 p-2 rounded-full bg-yellow-400/20 text-yellow-300 hover:bg-yellow-400/40 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                                                title="Melhorar Descrição com IA"
                                                            >
                                                                {isEnhancingPerspective ? (
                                                                     <div className="w-4 h-4 animate-spin rounded-full border-2 border-yellow-300 border-t-transparent"></div>
                                                                ) : (
                                                                     <IconSparkles className="w-4 h-4"/>
                                                                )}
                                                            </button>
                                                         </div>
                                                    </div>
                                                </motion.div>
                                            )}
                                            </AnimatePresence>
                                       </div>

                                      <div className="mt-6">
                                        <ReferenceImageUploader
                                            title="Trocar Roupa (Opcional)"
                                            onImageUpload={handleDirectClothingImageUpload}
                                            uploadedImage={directClothingImage}
                                            onRemoveImage={() => setDirectClothingImage(null)}
                                            isLoading={isUploadingDirectClothing}
                                        />
                                        <p className="text-xs text-gray-500 mt-2">
                                            Envie sua foto e uma foto da roupa. A IA tentará vestir você com a nova roupa mantendo sua pose e rosto.
                                        </p>
                                     </div>

                                     <div className="h-px bg-gray-700 my-8"></div>


                                     <div 
                                        className="flex items-center justify-between cursor-pointer bg-gray-800/60 p-4 rounded-lg hover:bg-gray-800 transition-colors"
                                        onClick={() => setIsThemeSelectorOpen(!isThemeSelectorOpen)}
                                     >
                                        <h3 className="text-xl font-semibold text-white">Ou, Escolha um Tema <span className="text-base text-gray-500 font-normal">(Requer Foto)</span></h3>
                                        <motion.div animate={{ rotate: isThemeSelectorOpen ? 180 : 0 }}>
                                            <IconChevronDown />
                                        </motion.div>
                                     </div>
                                    
                                     <AnimatePresence>
                                        {isThemeSelectorOpen && (
                                            <motion.div
                                                initial={{ height: 0, opacity: 0, marginTop: 0 }}
                                                animate={{ height: 'auto', opacity: 1, marginTop: '2rem' }}
                                                exit={{ height: 0, opacity: 0, marginTop: 0 }}
                                                className="overflow-hidden"
                                            >
                                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4">
                                                    {Object.entries(templates).map(([key, data]) => (
                                                        <TemplateCard
                                                            key={key}
                                                            id={key}
                                                            name={data.name}
                                                            icon={data.icon}
                                                            description={data.description}
                                                            isSelected={template === key}
                                                            onSelect={handleTemplateSelect}
                                                            numImages={numImages}
                                                            onNumImagesChange={setNumImages}
                                                        />
                                                    ))}
                                                 </div>
                                            </motion.div>
                                        )}
                                     </AnimatePresence>
                                     
                                     {template === 'personalizar' && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            className="p-6 border border-gray-700 rounded-xl space-y-6 bg-gray-800/50 mt-6"
                                        >
                                            <h3 className='text-xl font-semibold text-white'>Personalizar Câmera e Cena</h3>
                                            
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-400 mb-2">Ângulo da Câmera</label>
                                                    <div className="flex flex-wrap gap-2">
                                                        <RadioPill name="cameraAngle" value="Nível dos Olhos" label="Nível dos Olhos" checked={cameraAngle === 'Nível dos Olhos'} onChange={e => setCameraAngle(e.target.value)} />
                                                        <RadioPill name="cameraAngle" value="Plongê (de cima)" label="De Cima" checked={cameraAngle === 'Plongê (de cima)'} onChange={e => setCameraAngle(e.target.value)} />
                                                        <RadioPill name="cameraAngle" value="Contra-plongê (de baixo)" label="De Baixo" checked={cameraAngle === 'Contra-plongê (de baixo)'} onChange={e => setCameraAngle(e.target.value)} />
                                                        <RadioPill name="cameraAngle" value="Ângulo Holandês (inclinado)" label="Inclinado" checked={cameraAngle === 'Ângulo Holandês (inclinado)'} onChange={e => setCameraAngle(e.target.value)} />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-400 mb-2">Lente / Enquadramento</label>
                                                    <div className="flex flex-wrap gap-2">
                                                        <RadioPill name="cameraLens" value="Padrão (50mm)" label="Padrão" checked={cameraLens === 'Padrão (50mm)'} onChange={e => setCameraLens(e.target.value)} />
                                                        <RadioPill name="cameraLens" value="Grande Angular (24mm)" label="Grande Angular" checked={cameraLens === 'Grande Angular (24mm)'} onChange={e => setCameraLens(e.target.value)} />
                                                        <RadioPill name="cameraLens" value="Teleobjetiva (85mm)" label="Teleobjetiva" checked={cameraLens === 'Teleobjetiva (85mm)'} onChange={e => setCameraLens(e.target.value)} />
                                                        <RadioPill name="cameraLens" value="Olho de Peixe" label="Olho de Peixe" checked={cameraLens === 'Olho de Peixe'} onChange={e => setCameraLens(e.target.value)} />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-400 mb-2">Pose</label>
                                                    <div className="flex flex-wrap gap-2">
                                                        <RadioPill name="subjectPose" value="Como na foto original" label="Original" checked={subjectPose === 'Como na foto original'} onChange={e => setSubjectPose(e.target.value)} />
                                                        <RadioPill name="subjectPose" value="Em pé" label="Em pé" checked={subjectPose === 'Em pé'} onChange={e => setSubjectPose(e.target.value)} />
                                                        <RadioPill name="subjectPose" value="Sentado" label="Sentado" checked={subjectPose === 'Sentado'} onChange={e => setSubjectPose(e.target.value)} />
                                                        <RadioPill name="subjectPose" value="Pose de Ação" label="Ação" checked={subjectPose === 'Pose de Ação'} onChange={e => setSubjectPose(e.target.value)} />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-400 mb-2">Expressão Facial</label>
                                                    <div className="flex flex-wrap gap-2">
                                                        <RadioPill name="facialExpression" value="Como na foto original" label="Original" checked={facialExpression === 'Como na foto original'} onChange={e => setFacialExpression(e.target.value)} />
                                                        <RadioPill name="facialExpression" value="Neutra" label="Neutra" checked={facialExpression === 'Neutra'} onChange={e => setFacialExpression(e.target.value)} />
                                                        <RadioPill name="facialExpression" value="Feliz" label="Feliz" checked={facialExpression === 'Feliz'} onChange={e => setFacialExpression(e.target.value)} />
                                                        <RadioPill name="facialExpression" value="Surpreso" label="Surpreso" checked={facialExpression === 'Surpreso'} onChange={e => setFacialExpression(e.target.value)} />
                                                    </div>
                                                </div>
                                                 <div>
                                                    <label className="block text-sm font-medium text-gray-400 mb-2">Iluminação</label>
                                                    <div className="flex flex-wrap gap-2">
                                                        <RadioPill name="lightingStyle" value="Natural" label="Natural" checked={lightingStyle === 'Natural'} onChange={e => setLightingStyle(e.target.value)} />
                                                        <RadioPill name="lightingStyle" value="Estúdio" label="Estúdio" checked={lightingStyle === 'Estúdio'} onChange={e => setLightingStyle(e.target.value)} />
                                                        <RadioPill name="lightingStyle" value="Contraluz" label="Contraluz" checked={lightingStyle === 'Contraluz'} onChange={e => setLightingStyle(e.target.value)} />
                                                        <RadioPill name="lightingStyle" value="Alto Contraste" label="Alto Contraste" checked={lightingStyle === 'Alto Contraste'} onChange={e => setLightingStyle(e.target.value)} />
                                                    </div>
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-medium text-gray-400 mb-2">Composição</label>
                                                    <div className="flex flex-wrap gap-2">
                                                        <RadioPill name="compositionStyle" value="Como na foto original" label="Original" checked={compositionStyle === 'Como na foto original'} onChange={e => setCompositionStyle(e.target.value)} />
                                                        <RadioPill name="compositionStyle" value="Close-up Extremo" label="Close-up" checked={compositionStyle === 'Close-up Extremo'} onChange={e => setCompositionStyle(e.target.value)} />
                                                        <RadioPill name="compositionStyle" value="Plano Americano" label="Americano" checked={compositionStyle === 'Plano Americano'} onChange={e => setCompositionStyle(e.target.value)} />
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <div className="mt-2">
                                                <label className="block text-sm font-medium text-gray-400 mb-2">Cenário</label>
                                                <div className="flex flex-wrap gap-2">
                                                    <RadioPill name="backgroundOption" value="manter" label="Manter Original" checked={backgroundOption === 'manter'} onChange={e => setBackgroundOption(e.target.value)} />
                                                    <RadioPill name="backgroundOption" value="mudar" label="Mudar Cenário" checked={backgroundOption === 'mudar'} onChange={e => setBackgroundOption(e.target.value)} />
                                                </div>
                                            </div>

                                            <AnimatePresence>
                                                {backgroundOption === 'mudar' && (
                                                    <motion.div
                                                        initial={{ opacity: 0, y: -10 }}
                                                        animate={{ opacity: 1, y: 0 }}
                                                        exit={{ opacity: 0, y: -10 }}
                                                    >
                                                        <input
                                                            type="text"
                                                            placeholder="Descreva o novo cenário..."
                                                            value={backgroundDescription}
                                                            onChange={(e) => setBackgroundDescription(e.target.value)}
                                                            className="w-full bg-gray-800 border border-gray-600 rounded-lg py-2 px-4 focus:outline-none focus:ring-2 focus:ring-yellow-400 text-white mt-2"
                                                        />
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </motion.div>
                                     )}
                                     
                                     {template === 'figurines' && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            transition={{ duration: 0.3 }}
                                            className="p-6 border border-gray-700 rounded-xl space-y-6 bg-gray-800/50 mt-6"
                                        >
                                            <h3 className='text-xl font-semibold text-white'>Personalizar Miniatura</h3>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-400 mb-2">Título da Embalagem</label>
                                                <input
                                                    type="text"
                                                    placeholder="Ex: Herói Galáctico"
                                                    value={figurineBoxTitle}
                                                    onChange={(e) => setFigurineBoxTitle(e.target.value)}
                                                    className="w-full bg-gray-800 border border-gray-600 rounded-lg py-2 px-4 focus:outline-none focus:ring-2 focus:ring-yellow-400 text-white"
                                                />
                                            </div>
                                            <ReferenceImageUploader
                                                title="Enviar Imagem de Acessório (Opcional)"
                                                onImageUpload={handleAccessoryImageUpload}
                                                uploadedImage={figurineAccessoryImage}
                                                onRemoveImage={() => setFigurineAccessoryImage(null)}
                                                isLoading={isUploadingAccessory}
                                            />
                                        </motion.div>
                                     )}
                                     
                                     {template === 'hairStyler' && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            transition={{ duration: 0.3 }}
                                            className="p-6 border border-gray-700 rounded-xl space-y-6 bg-gray-800/50 mt-6"
                                        >
                                            <h3 className='text-xl font-semibold text-white'>Personalizar Penteado</h3>
                                            
                                            <ReferenceImageUploader 
                                                title="Enviar Imagem de Corte (Opcional)"
                                                onImageUpload={handleHaircutImageUpload}
                                                uploadedImage={haircutImage}
                                                onRemoveImage={() => setHaircutImage(null)}
                                                isLoading={isUploadingHaircut}
                                            />
                                            
                                            {!haircutImage && (
                                                <>
                                            <div>
                                                <div className="flex justify-between items-center">
                                                    <label className="block text-sm font-medium text-gray-400 mb-3">Estilo (selecione até 6)</label>
                                                    <span className={`text-sm font-bold ${totalSelectedStyles >= 6 ? 'text-yellow-400' : 'text-gray-500'}`}>{totalSelectedStyles} / 6</span>
                                                </div>
                                                <div className="flex flex-wrap gap-3">
                                                    {templates.hairStyler.prompts.map(prompt => (
                                                        <button
                                                            key={prompt.id}
                                                            onClick={() => handleHairStyleSelect(prompt.id)}
                                                            className={`cursor-pointer px-3 py-1.5 text-sm rounded-full transition-colors font-semibold 
                                                                ${selectedHairStyles.includes(prompt.id) ? 'bg-yellow-400 text-black' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}
                                                        >
                             
                                                            {prompt.id}
                                                        </button>
                                                    ))}
                                                    <button
                                                        onClick={() => handleHairStyleSelect('Outro')}
                                                        className={`cursor-pointer px-3 py-1.5 text-sm rounded-full transition-colors font-semibold 
                                                            ${isCustomHairActive ? 'bg-yellow-400 text-black' : 'bg-gray-800 hover:bg-gray-700 text-gray-300'}`}
                                                    >
                                                        Outro...
                                                    </button>
                                                </div>
                                            </div>
                                            
                                            {isCustomHairActive && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: -10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                >
                                                    <label className="block text-sm font-medium text-gray-400 mb-2">Seu Estilo Personalizado</label>
                                                    <input
                                                        type="text"
                                                        placeholder="ex: Um moicano rosa vibrante"
                                                        value={customHairStyle}
                                                        onChange={(e) => setCustomHairStyle(e.target.value)}
                                                        className="w-full bg-gray-800 border border-gray-600 rounded-lg py-2 px-4 focus:outline-none focus:ring-2 focus:ring-yellow-400 text-white"
                                                    />
                                                </motion.div>
                                            )}

                                            <div>
                                                <label className="block text-sm font-medium text-gray-400 mb-3">Cor do Cabelo</label>
                                                <div className="flex items-center gap-4 flex-wrap">
                                                    {hairColors.map((color, index) => (
                                                        <motion.div
                                                            key={index}
                                                            initial={{ opacity: 0, scale: 0.8 }}
                                                            animate={{ opacity: 1, scale: 1 }}
                                                            className="flex items-center gap-2 p-2 bg-gray-700/50 rounded-lg border border-gray-600"
                                                        >
                                                            <div className="relative w-10 h-10 rounded-md overflow-hidden" style={{ backgroundColor: color }}>
                                                                <input
                                                                    type="color"
                                                                    value={color}
                                                                    onChange={(e) => handleColorChange(index, e.target.value)}
                                                                    className="absolute inset-0 w-full h-full cursor-pointer opacity-0"
                                                                />
                                                            </div>
                                                            <span className="font-mono text-sm text-gray-300 uppercase">{color}</span>
                                                            <button
                                                                onClick={() => removeHairColor(index)}
                                                                className="p-1 rounded-full text-gray-500 hover:bg-gray-600 hover:text-red-400 transition-colors"
                                                                aria-label="Remover cor"
                                                            >
                                                                <IconX />
                                                            </button>
                                                        </motion.div>
                                                    ))}

                                                    {hairColors.length < 2 && (
                                                        <button
                                                            onClick={addHairColor}
                                                            className="flex items-center justify-center gap-2 h-[68px] px-4 rounded-lg border-2 border-dashed border-gray-600 hover:border-yellow-400 text-gray-400 hover:text-yellow-400 transition-colors bg-gray-700/30"
                                                        >
                                                            <IconPlus />
                                                            <span>{hairColors.length === 0 ? 'Adicionar Cor' : 'Adicionar Mecha'}</span>
                                                        </button>
                                                    )}
                                                </div>
                                                {hairColors.length > 0 && (
                                                     <button onClick={() => setHairColors([])} className="text-xs text-gray-500 hover:text-white transition-colors mt-3">
                                                        Limpar todas as cores
                                                    </button>
                                                )}
                                            </div>
                                            </>
                                            )}
                                        </motion.div>
                                     )}

                                     {template === 'headshots' && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            transition={{ duration: 0.3 }}
                                            className="p-6 border border-gray-700 rounded-xl space-y-6 bg-gray-800/50 mt-6"
                                        >
                                            <h3 className='text-xl font-semibold text-white'>Personalizar Foto Profissional</h3>
                                            <div>
                                                <label className="block text-sm font-medium text-gray-400 mb-3">Expressão Facial</label>
                                                <div className="flex flex-wrap gap-3">
                                                    <RadioPill name="expression" value="Sorriso Amigável" label="Sorriso Amigável" checked={headshotExpression === 'Sorriso Amigável'} onChange={e => setHeadshotExpression(e.target.value)} />
                                                    <RadioPill name="expression" value="Olhar Confiante" label="Olhar Confiante" checked={headshotExpression === 'Olhar Confiante'} onChange={e => setHeadshotExpression(e.target.value)} />
                                                    <RadioPill name="expression" value="Olhar Pensativo" label="Olhar Pensativo" checked={headshotExpression === 'Olhar Pensativo'} onChange={e => setHeadshotExpression(e.target.value)} />
                                                </div>
                                            </div>
                                             <div>
                                                <label className="block text-sm font-medium text-gray-400 mb-3">Pose</label>
                                                 <div className="flex flex-wrap gap-3">
                                                    <RadioPill name="pose" value="Frente" label="Virado para Frente" checked={headshotPose === 'Frente'} onChange={e => setHeadshotPose(e.target.value)} />
                                                    <RadioPill name="pose" value="Ângulo" label="Leve Ângulo" checked={headshotPose === 'Ângulo'} onChange={e => setHeadshotPose(e.target.value)} />
                                                </div>
                                            </div>
                                         </motion.div>
                                     )}

                                     {template === 'styleLookbook' && (
                                        <motion.div
                                            initial={{ opacity: 0, height: 0 }}
                                            animate={{ opacity: 1, height: 'auto' }}
                                            transition={{ duration: 0.3 }}
                                            className="p-6 border border-gray-700 rounded-xl space-y-6 bg-gray-800/50 mt-6"
                                        >
                                            <h3 className='text-xl font-semibold text-white'>Escolha um Estilo de Moda</h3>
                                            
                                            <ReferenceImageUploader 
                                                title="Enviar Imagem de Roupa (Opcional)"
                                                onImageUpload={handleClothingImageUpload}
                                                uploadedImage={clothingImage}
                                                onRemoveImage={() => setClothingImage(null)}
                                                isLoading={isUploadingClothing}
                                            />

                                            {!clothingImage && (
                                            <>
                                            <div>
                                                <div className="flex flex-wrap gap-3">
                                                    {templates.styleLookbook.styles.map(style => (
                                                        <RadioPill 
                                                            key={style}
                                                            name="style" 
                                                            value={style} 
                                                            label={style} 
                                                            checked={lookbookStyle === style} 
                                                            onChange={e => {
                                                                setLookbookStyle(e.target.value);
                                                                setCustomLookbookStyle('');
                                                            }}
                                                        />
                                                    ))}
                                                    <RadioPill
                                                        name="style"
                                                        value="Outro"
                                                        label="Outro..."
                                                        checked={lookbookStyle === 'Outro'}
                                                        onChange={e => setLookbookStyle(e.target.value)}
                                                    />
                                                </div>
                                            </div>
                                            {lookbookStyle === 'Outro' && (
                                                <motion.div
                                                    initial={{ opacity: 0, y: -10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                >
                                                    <label className="block text-sm font-medium text-gray-400 mb-2">Seu Estilo Personalizado</label>
                                                    <input
                                                        type="text"
                                                        placeholder="ex: Cyberpunk, Avant-garde"
                                                        value={customLookbookStyle}
                                                        onChange={(e) => setCustomLookbookStyle(e.target.value)}
                                                        className="w-full bg-gray-800 border border-gray-600 rounded-lg py-2 px-4 focus:outline-none focus:ring-2 focus:ring-yellow-400 text-white"
                                                    />
                                                </motion.div>
                                            )}
                                            </>
                                            )}
                                        </motion.div>
                                     )}
                                </div>
                            </div>

                            <div className="mt-12 text-center">
                                 <Button
                                    onClick={handleGenerateClick}
                                    disabled={isGenerateButtonDisabled}
                                    primary
                                    className="text-lg px-12 py-4"
                                 >
                                    <div className="flex items-center gap-3">
                                        {isLoading || isSettingUp ? (
                                            <>
                                                <div className="animate-spin rounded-full h-5 w-5 border-t-2 border-b-2 border-black"></div>
                                                {isSettingUp ? "Preparando o cenário..." : `Gerando... (${Math.round(progress)}%)`}
                                            </>
                                        ) : (
                                            <>
                                                <IconSparkles />
                                                {buttonText}
                                            </>
                                        )}
                                    </div>
                                 </Button>
                            </div>
                        </div>


                        <div ref={resultsRef}>
                            {isSettingUp && (
                                <div className="text-center my-20 flex flex-col items-center p-10 bg-gray-900/70 rounded-2xl">
                                    <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-pink-500 mb-6"></div>
                                    <p className="text-2xl text-pink-400 font-semibold tracking-wider italic">Arrumando o cabelo e ligando os lasers...</p>
                                    <p className="text-gray-400 mt-2">Gerando um estilo de sessão de fotos totalmente tubular dos anos 80!</p>
                                </div>
                            )}
                            
                            {(isLoading || generatedImages.length > 0) && !isSettingUp && (
                                <div className="mt-16">
                                    <h2 className="text-3xl font-bold text-white mb-8 text-center">Suas Fotos Geradas</h2>

                                    {isLoading && (
                                        <div className="w-full max-w-4xl mx-auto mb-8 text-center">
                                            <div className="bg-gray-800 rounded-full h-3 overflow-hidden shadow-md">
                                                <motion.div
                                                    className="bg-yellow-400 h-3 rounded-full"
                                                    initial={{ width: 0 }}
                                                    animate={{ width: `${progress}%` }}
                                                    transition={{ duration: 0.5 }}
                                                />
                                            </div>
                                            <p className="text-gray-400 mt-4 text-sm">Por favor, mantenha esta janela aberta enquanto suas fotos são geradas.</p>
                                        </div>
                                    )}
                                     <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 md:gap-8 lg:gap-10 mt-6 sm:mt-8 ${
                                         generatedImages.length > 0 && generatedImages[0].template === 'hairStyler' && haircutImage 
                                            ? 'lg:grid-cols-1 justify-center max-w-sm mx-auto' 
                                            : generatedImages.length > 0 && generatedImages[0].template === 'styleLookbook' && clothingImage 
                                            ? 'lg:grid-cols-2 max-w-3xl mx-auto'
                                            : generatedImages.length > 0 && ['personalizar', 'promptBased', 'directSwap', 'figurinha', 'spotlightPortrait', 'cinematicStreetStyle', 'shadowPortrait', 'viceCityStyle', 'urbanNeon', 'bwProfile', 'projectedSilhouette', 'popMagazineCover', 'editorialTechRetro', 'mysteriousEditorial', 'architectStyle'].includes(generatedImages[0].template)
                                            ? 'lg:grid-cols-1 justify-center max-w-md mx-auto'
                                            : generatedImages.length > 3
                                            ? 'md:grid-cols-3 lg:grid-cols-4'
                                            : 'md:grid-cols-2 lg:grid-cols-3'
                                        }`}>
                                        <AnimatePresence>
                                        {generatedImages.map((img, index) => {
                                            const activeTemplate = templates[img.template] || {};
                                            const isPolaroid = activeTemplate.isPolaroid;
                                            
                                            const themesWithoutLabel = ['headshots', 'eightiesMall', 'styleLookbook', 'figurines', 'hairStyler', 'personalizar', 'promptBased', 'directSwap', 'figurinha', 'cinematicPortrait', 'fashionEditorial', 'streetwearDeLuxo', 'urbanoFuturista', 'luxoNoturno', 'undergroundFuturista', 'ensaioNatalino', 'spotlightPortrait', 'cinematicStreetStyle', 'shadowPortrait', 'viceCityStyle', 'urbanNeon', 'bwProfile', 'projectedSilhouette', 'popMagazineCover', 'editorialTechRetro', 'mysteriousEditorial', 'architectStyle'];
                                            let showLabel = !themesWithoutLabel.includes(img.template);
                                            // Caso especial: não mostrar label se uma imagem de corte for enviada
                                            if (img.template === 'hairStyler' && haircutImage) showLabel = false;
                                            if (img.template === 'styleLookbook' && clothingImage) showLabel = false;
                                            
                                            switch (img.status) {
                                                case 'success':
                                                    return <PhotoDisplay
                                                        key={`${img.id}-${index}-success`}
                                                        era={img.id}
                                                        imageUrl={img.imageUrl}
                                                        onDownload={handleDownloadRequest}
                                                        onRegenerate={() => regenerateImageAtIndex(index)}
                                                        onEdit={() => handleEditRequest(index)}
                                                        onDelete={() => handleDeleteImage(index)}
                                                        onShare={() => handleShare(img.imageUrl, img.id)}
                                                        onSave={() => handleSaveToHistory(index)}
                                                        isPolaroid={isPolaroid}
                                                        index={index}
                                                        showLabel={showLabel}
                                                    />;
                                                case 'failed':
                                                    return <ErrorCard
                                                        key={`${img.id}-${index}-failed`}
                                                        era={img.id}
                                                        isPolaroid={isPolaroid}
                                                        onRegenerate={() => regenerateImageAtIndex(index)}
                                                        showLabel={showLabel}
                                                    />;
                                                case 'pending':
                                                default:
                                                    return <LoadingCard 
                                                        key={`${img.id}-${index}-pending`} 
                                                        era={img.id} 
                                                        isPolaroid={isPolaroid}
                                                        showLabel={showLabel} />;
                                            }
                                        })}
                                        </AnimatePresence>
                                    </div>
                                </div>
                            )}

                            {!isLoading && generatedImages.length > 0 && (
                                <div className="text-center mt-16 mb-12 flex justify-center gap-6">
                                    <Button onClick={() => handleStartOver(false)}>Começar de Novo</Button>
                                    {generatedImages.length > 1 && generatedImages[0].template !== 'figurinha' && <AlbumDownloadButton />}
                                </div>
                            )}
                        </div>
                    </main>
                </div>
            </div>
        </>
    );
};

export default App;
