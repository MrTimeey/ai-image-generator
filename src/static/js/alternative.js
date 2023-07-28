function onSubmit(e) {
    e.preventDefault();

    let msgElement = document.createElement('h2');
    msgElement.classList.add('msg');

    document.getElementsByClassName('image-container')[0].replaceChildren();
    document.getElementsByClassName('image-container')[0].appendChild(msgElement);

    let baseImagePath = document.querySelector('#baseImage').value;
    const baseImage = document.querySelector('#hiddenBaseImage');
    const size = document.querySelector('#size').value;
    const amount = document.querySelector('#amount').value;

    if (baseImagePath === '') {
        alert('Please choose an image');
        return;
    }
    const regex = /fakepath\\(.*?\.(\bpng\b|\bjpeg\b))/;
    if (regex.test(baseImagePath)) {
        const matched = baseImagePath.match(regex) ?? [];
        baseImagePath = matched.length > 0 ? matched[1] : baseImagePath;
    }
    generateImageAlternatives(baseImage.src, baseImagePath, size, amount);
}

async function generateImageAlternatives(image, baseImageName, size, amount) {
    try {
        showSpinner();

        const response = await fetch('/api/openai/generate-alternative-images', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                baseImage: image,
                originalImageName: baseImageName,
                amount: parseInt(amount),
                size: size.toUpperCase(),
            }),
        });

        if (!response.ok) {
            removeSpinner();
            throw new Error('The alternative could not be generated');
        }

        const data = await response.json();

        let imagesContainer = document.getElementsByClassName('image-container')[0];
        data.images.forEach((imageUrl) => {
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function readURL(input) {
    if (input.files && input.files[0]) {
        const reader = new FileReader();

        reader.onload = function (e) {
            document.querySelector('#hiddenBaseImage').src = e.target.result;
        };

        reader.readAsDataURL(input.files[0]);
    }
}

document.querySelector('#image-form').addEventListener('submit', onSubmit);
