function onSubmit(e) {
    e.preventDefault();

    let msgElement = document.createElement('h2');
    msgElement.classList.add('msg');

    document.getElementsByClassName('image-container')[0].replaceChildren();
    document.getElementsByClassName('image-container')[0].appendChild(msgElement);

    const prompt = document.querySelector('#prompt').value;
    const size = document.querySelector('#size').value;
    const model = document.querySelector('#model').value;
    const amount = document.querySelector('#amount').value;

    if (prompt === '') {
        alert('Please add some text');
        return;
    }

    generateImageRequest(prompt, model, size, amount);
}

async function generateImageRequest(prompt, model, size, amount) {
    try {
        showSpinner();

        const response = await fetch('/api/openai/generate-images', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                description: prompt,
                languageModel: model,
                amount: parseInt(amount),
                size: size.toUpperCase(),
            }),
        });

        if (!response.ok) {
            removeSpinner();
            throw new Error('That image could not be generated');
        }

        const data = await response.json();

        let imagesContainer = document.getElementsByClassName('image-container')[0];
        data.images.forEach((imageResponse) => {
            let imageElement = document.createElement('img');
            imageElement.src = imageResponse.url;
            imagesContainer.appendChild(imageElement);
        });
    } catch (error) {
        document.querySelector('.msg').textContent = error;
    } finally {
        removeSpinner();
    }
}

function showSpinner() {
    document.querySelector('.spinner').classList.add('show');
}

function removeSpinner() {
    document.querySelector('.spinner').classList.remove('show');
}

function changePossibleValues() {
    const selectedLanguageModel = languageModelValues.value;
    if (selectedLanguageModel === 'DALL_E_TWO') {
        addOptionValue('#amount', '1', '1', true);
        addOptionValue('#amount', '2', '2');
        addOptionValue('#amount', '3', '3');
        addOptionValue('#amount', '4', '4');
        addOptionValue('#size', 'Small', 'small', true);
        addOptionValue('#size', 'Medium', 'medium');
        addOptionValue('#size', 'Large', 'large');
        removeOptionValue('#size', 'large_wide');
        removeOptionValue('#size', 'large_horizontal');
    } else {
        addOptionValue('#amount', '1', '1', true);
        removeOptionValue('#amount', '2');
        removeOptionValue('#amount', '3');
        removeOptionValue('#amount', '4');
        removeOptionValue('#size', 'small');
        removeOptionValue('#size', 'medium');
        addOptionValue('#size', 'Large', 'large', true);
        addOptionValue('#size', 'Large Vertical', 'large_vertical');
        addOptionValue('#size', 'Large Horizontal', 'large_horizontal');
    }
}

function addOptionValue(target, text, value, selected = false) {
    for (const opt of document.querySelector(target).options) {
        if (opt.value === value) {
            if (selected) opt.selected = selected;
            return;
        }
    }
    const option = document.createElement('option');
    option.value = value;
    option.innerHTML = text;
    option.selected = selected;

    document.querySelector(target).appendChild(option);
}

function removeOptionValue(target, value) {
    for (const opt of document.querySelector(target).options) {
        if (opt.value === value) {
            document.querySelector(target).removeChild(opt);
        }
    }
}

document.querySelector('#image-form').addEventListener('submit', onSubmit);

const languageModelValues = document.querySelector('#model');
languageModelValues.addEventListener('click', changePossibleValues);
