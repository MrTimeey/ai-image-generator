function onSubmit(e) {
    e.preventDefault();

    let msgElement = document.createElement('h2');
    msgElement.classList.add('msg');

    document.getElementsByClassName('image-container')[0].replaceChildren();
    document.getElementsByClassName('image-container')[0].appendChild(msgElement);

    const prompt = document.querySelector('#prompt').value;
    const size = document.querySelector('#size').value;
    const amount = document.querySelector('#amount').value;

    if (prompt === '') {
        alert('Please add some text');
        return;
    }

    generateImageRequest(prompt, size, amount);
}

async function generateImageRequest(prompt, size, amount) {
    try {
        showSpinner();

        const response = await fetch('/api/openai/generate-images', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                description: prompt,
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
        data.urls.forEach((imageUrl) => {
            let imageElement = document.createElement('img');
            imageElement.src = imageUrl.url;
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

document.querySelector('#image-form').addEventListener('submit', onSubmit);
